import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commands } from "../lib/engine.ts";
import { namedLabTargets, validationFor } from "../lib/platform-validation.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtInCommands = new Map(commands.filter((command) => !command.custom).map((command) => [command.id, command]));
const targets = new Map(namedLabTargets.map((target) => [target.id, target]));

export const targetSoftwareVersions = Object.freeze({
  "cml-iosv-15.9-3-m9": "15.9(3)M9",
  "cml-iosvl2-15.2": "15.2",
  "cml-cat8000v-17.15.01a": "17.15.01a",
  "cml-iol-l2-17.15.01": "17.15.01",
});

const promptPatterns = {
  user: /^[^\r\n()]+>$/u,
  privileged: /^[^\r\n()]+#$/u,
  global: /^[^\r\n]+\(config\)#$/u,
  interface: /^[^\r\n]+\(config-if\)#$/u,
  router: /^[^\r\n]+\(config-router\)#$/u,
  line: /^[^\r\n]+\(config-line\)#$/u,
  vlan: /^[^\r\n]+\(config-vlan\)#$/u,
  acl: /^[^\r\n]+\(config-(?:std-|ext-)?nacl\)#$/u,
  dhcp: /^[^\r\n]+\(dhcp-config\)#$/u,
};

const recordFields = new Set([
  "recordId",
  "capturedAt",
  "operator",
  "targetId",
  "targetLabel",
  "targetSoftwareVersion",
  "platformIdentity",
  "commandId",
  "expectedMode",
  "promptBefore",
  "input",
  "outcome",
  "resultNotes",
  "evidenceRef",
  "evidenceLocator",
  "evidenceSha256",
]);
const manifestFields = new Set(["schemaVersion", "records"]);

const normaliseCommand = (value) => value.trim().replace(/\s+/gu, " ").toLowerCase();
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value, maximum = 2_000) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;

export const sha256ForFile = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const evidencePathFor = (root, evidenceRef) => {
  if (typeof evidenceRef !== "string" || isAbsolute(evidenceRef) || evidenceRef.includes("\\")) return null;
  const resolved = resolve(root, evidenceRef);
  const evidenceRoot = resolve(root, "validation", "evidence");
  const fromEvidenceRoot = relative(evidenceRoot, resolved);
  if (!fromEvidenceRoot || fromEvidenceRoot === ".." || fromEvidenceRoot.startsWith(`..${sep}`) || isAbsolute(fromEvidenceRoot)) return null;
  return resolved;
};

export const validateLabEvidenceManifest = (manifest, options = {}) => {
  const root = resolve(options.projectRoot ?? projectRoot);
  const errors = [];

  if (!isObject(manifest)) {
    return {
      ok: false,
      errors: ["Manifest must be a JSON object."],
      summary: { records: 0, accepted: 0, rejected: 0, candidateCommandIds: [], targetIds: [] },
    };
  }
  for (const field of Object.keys(manifest)) {
    if (!manifestFields.has(field)) errors.push(`${field} is not a recognised manifest field.`);
  }
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!Array.isArray(manifest.records)) errors.push("records must be an array.");
  for (const target of namedLabTargets) {
    const version = targetSoftwareVersions[target.id];
    if (!version || !target.label.includes(version)) {
      errors.push(`Named target ${target.id} is missing matching software-version metadata in the evidence validator.`);
    }
  }
  for (const targetId of Object.keys(targetSoftwareVersions)) {
    if (!targets.has(targetId)) errors.push(`Evidence software-version metadata names unknown target ${targetId}.`);
  }
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const recordIds = new Set();

  records.forEach((record, index) => {
    const at = `records[${index}]`;
    if (!isObject(record)) {
      errors.push(`${at} must be an object.`);
      return;
    }
    for (const field of Object.keys(record)) {
      if (!recordFields.has(field)) errors.push(`${at}.${field} is not a recognised evidence field.`);
    }

    if (!isNonEmptyString(record.recordId, 120) || !/^[a-z0-9][a-z0-9._-]*$/u.test(record.recordId)) {
      errors.push(`${at}.recordId must use lowercase letters, numbers, dots, underscores or hyphens.`);
    } else if (recordIds.has(record.recordId)) {
      errors.push(`${at}.recordId duplicates ${record.recordId}.`);
    } else {
      recordIds.add(record.recordId);
    }

    if (!isNonEmptyString(record.capturedAt, 40) || Number.isNaN(Date.parse(record.capturedAt)) || !record.capturedAt.endsWith("Z")) {
      errors.push(`${at}.capturedAt must be a valid UTC ISO-8601 timestamp ending in Z.`);
    }
    if (!isNonEmptyString(record.operator, 120)) errors.push(`${at}.operator is required.`);

    const target = targets.get(record.targetId);
    if (!target) {
      errors.push(`${at}.targetId is not one of the named targets in lib/platform-validation.ts.`);
    } else {
      if (record.targetLabel !== target.label) errors.push(`${at}.targetLabel must exactly match ${target.label}.`);
      const targetVersion = targetSoftwareVersions[target.id];
      if (record.targetSoftwareVersion !== targetVersion) {
        errors.push(`${at}.targetSoftwareVersion must be ${targetVersion} for ${target.id}.`);
      }
      if (!target.label.includes(targetVersion)) {
        errors.push(`Internal target metadata for ${target.id} does not include its declared software version.`);
      }
    }
    if (!isNonEmptyString(record.platformIdentity, 500) ||
        (typeof record.targetSoftwareVersion === "string" && !record.platformIdentity.toLowerCase().includes(record.targetSoftwareVersion.toLowerCase()))) {
      errors.push(`${at}.platformIdentity must quote an identifying show version line containing the target software version.`);
    }

    const command = builtInCommands.get(record.commandId);
    if (!command) {
      errors.push(`${at}.commandId is not a built-in catalogue command.`);
    } else {
      const assignedTargets = validationFor(command).targetIds;
      if (target && !assignedTargets.includes(target.id)) {
        errors.push(`${at}.targetId is not assigned to ${command.id} by lib/platform-validation.ts.`);
      }
      if (record.expectedMode !== command.mode) {
        errors.push(`${at}.expectedMode must be ${command.mode} for ${command.id}.`);
      }
      if (record.outcome === "accepted" && isNonEmptyString(record.input, 500) &&
          normaliseCommand(record.input) !== normaliseCommand(command.canonical)) {
        errors.push(`${at}.input must be the catalogue's canonical command for accepted evidence.`);
      }
    }

    const promptPattern = promptPatterns[record.expectedMode];
    if (!isNonEmptyString(record.promptBefore, 200) || !promptPattern?.test(record.promptBefore)) {
      errors.push(`${at}.promptBefore does not match the declared starting CLI mode.`);
    }
    if (!isNonEmptyString(record.input, 500)) errors.push(`${at}.input is required.`);
    if (record.outcome !== "accepted" && record.outcome !== "rejected") {
      errors.push(`${at}.outcome must be accepted or rejected.`);
    }
    if (!isNonEmptyString(record.resultNotes) || record.resultNotes.trim().length < 12) {
      errors.push(`${at}.resultNotes must describe the observed result in at least 12 characters.`);
    }
    if (!isNonEmptyString(record.evidenceLocator, 200)) errors.push(`${at}.evidenceLocator is required.`);

    const evidencePath = evidencePathFor(root, record.evidenceRef);
    if (!evidencePath) {
      errors.push(`${at}.evidenceRef must be a repository-relative path below validation/evidence using forward slashes.`);
    } else if (!existsSync(evidencePath) || !statSync(evidencePath).isFile()) {
      errors.push(`${at}.evidenceRef does not point to an existing evidence file.`);
    } else if (lstatSync(evidencePath).isSymbolicLink()) {
      errors.push(`${at}.evidenceRef must not be a symbolic link.`);
    } else if (!/^[a-f0-9]{64}$/u.test(record.evidenceSha256 ?? "")) {
      errors.push(`${at}.evidenceSha256 must be a lowercase SHA-256 digest.`);
    } else if (sha256ForFile(evidencePath) !== record.evidenceSha256) {
      errors.push(`${at}.evidenceSha256 does not match the evidence file.`);
    }
  });

  const acceptedRecords = records.filter((record) => isObject(record) && record.outcome === "accepted");
  const rejectedRecords = records.filter((record) => isObject(record) && record.outcome === "rejected");
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      records: records.length,
      accepted: acceptedRecords.length,
      rejected: rejectedRecords.length,
      candidateCommandIds: [...new Set(acceptedRecords.map((record) => record.commandId))].sort(),
      targetIds: [...new Set(records.map((record) => record.targetId).filter((id) => targets.has(id)))].sort(),
    },
  };
};

export const validateLabEvidenceFile = (manifestPath, options = {}) => {
  const resolvedManifestPath = resolve(manifestPath);
  const manifest = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
  return validateLabEvidenceManifest(manifest, {
    projectRoot: options.projectRoot ?? resolve(dirname(resolvedManifestPath), ".."),
  });
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const manifestPath = resolve(process.argv[2] ?? resolve(projectRoot, "validation", "lab-evidence.json"));
  try {
    const result = validateLabEvidenceFile(manifestPath, { projectRoot });
    if (!result.ok) {
      console.error(`Lab evidence validation failed with ${result.errors.length} error(s):`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      const { records, accepted, rejected } = result.summary;
      console.log(`Lab evidence manifest is structurally valid: ${records} record(s), ${accepted} accepted, ${rejected} rejected.`);
      console.log("This validator checks metadata and file integrity only; it does not mark commands image-verified.");
    }
  } catch (error) {
    console.error(`Unable to validate ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
