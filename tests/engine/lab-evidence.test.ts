import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  sha256ForFile,
  validateLabEvidenceFile,
  validateLabEvidenceManifest,
} from "../../scripts/validate-lab-evidence.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const makeFixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "cli-rush-lab-evidence-"));
  const evidenceDirectory = resolve(root, "validation", "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidencePath = resolve(evidenceDirectory, "iosv-nav-enable.txt");
  writeFileSync(
    evidencePath,
    "Cisco IOS Software, IOSv Software, Version 15.9(3)M9\nR1>enable\nR1#\n",
    "utf8",
  );
  const record = {
    recordId: "2026-07-11-iosv-nav-enable-01",
    capturedAt: "2026-07-11T12:00:00.000Z",
    operator: "lab-reviewer",
    targetId: "cml-iosv-15.9-3-m9",
    targetLabel: "Cisco CML IOSv 15.9(3)M9",
    targetSoftwareVersion: "15.9(3)M9",
    platformIdentity: "Cisco IOS Software, IOSv Software, Version 15.9(3)M9",
    commandId: "nav.enable",
    expectedMode: "user",
    promptBefore: "R1>",
    input: "enable",
    outcome: "accepted",
    resultNotes: "The prompt changed to R1# without a parser error.",
    evidenceRef: "validation/evidence/iosv-nav-enable.txt",
    evidenceLocator: "lines 1-3",
    evidenceSha256: sha256ForFile(evidencePath),
  };
  return { root, evidencePath, record };
};

test("the repository evidence manifest is valid and makes no image-verification claim", () => {
  const manifestPath = resolve(repositoryRoot, "validation", "lab-evidence.json");
  const result = validateLabEvidenceFile(manifestPath, { projectRoot: repositoryRoot });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.summary, {
    records: 0,
    accepted: 0,
    rejected: 0,
    candidateCommandIds: [],
    targetIds: [],
  });
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")).records, []);
});

test("accepts a complete target-specific evidence record without calling it verified", (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const result = validateLabEvidenceManifest({ schemaVersion: 1, records: [fixture.record] }, { projectRoot: fixture.root });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.summary.accepted, 1);
  assert.deepEqual(result.summary.candidateCommandIds, ["nav.enable"]);
  assert.equal("verified" in result.summary, false);
});

test("records a canonical rejection as compatibility evidence, not successful verification", (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const rejectedRecord = {
    ...fixture.record,
    recordId: "2026-07-11-iosv-nav-enable-rejected-01",
    outcome: "rejected",
    resultNotes: "The image returned an explicit parser error at the enable keyword.",
  };
  const result = validateLabEvidenceManifest({ schemaVersion: 1, records: [rejectedRecord] }, { projectRoot: fixture.root });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.summary.rejected, 1);
  assert.deepEqual(result.summary.candidateCommandIds, []);
});

test("rejects target, mode, canonical-input and evidence-integrity drift", (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const record = {
    ...fixture.record,
    targetId: "cml-iosvl2-15.2",
    targetLabel: "Cisco CML IOSvL2 15.2",
    targetSoftwareVersion: "15.2",
    platformIdentity: "Cisco IOSvL2 Software Version 15.2",
    expectedMode: "privileged",
    promptBefore: "R1#",
    input: "en",
    evidenceSha256: "0".repeat(64),
  };
  const result = validateLabEvidenceManifest({ schemaVersion: 1, records: [record] }, { projectRoot: fixture.root });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("not assigned to nav.enable")));
  assert.ok(result.errors.some((error) => error.includes("expectedMode must be user")));
  assert.ok(result.errors.some((error) => error.includes("canonical command")));
  assert.ok(result.errors.some((error) => error.includes("does not match the evidence file")));
});

test("rejects missing, escaping and modified evidence files", (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const escaping = validateLabEvidenceManifest({
    schemaVersion: 1,
    records: [{ ...fixture.record, evidenceRef: "../capture.txt" }],
  }, { projectRoot: fixture.root });
  assert.ok(escaping.errors.some((error) => error.includes("below validation/evidence")));

  const missing = validateLabEvidenceManifest({
    schemaVersion: 1,
    records: [{ ...fixture.record, evidenceRef: "validation/evidence/missing.txt" }],
  }, { projectRoot: fixture.root });
  assert.ok(missing.errors.some((error) => error.includes("existing evidence file")));

  writeFileSync(fixture.evidencePath, "modified after hashing", "utf8");
  const modified = validateLabEvidenceManifest({ schemaVersion: 1, records: [fixture.record] }, { projectRoot: fixture.root });
  assert.ok(modified.errors.some((error) => error.includes("does not match the evidence file")));
});
