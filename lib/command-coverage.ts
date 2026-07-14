import {
  buildCommandRegistry,
  type CommandProduction,
  type RegistryContext,
} from "./command-registry.ts";
import type { ActiveCustomCommand, CustomCommandRecord } from "./custom-commands.ts";
import {
  deviceProfiles,
  getDeviceProfile,
  type DeviceProfileId,
} from "./device-profiles.ts";
import type { Command } from "./engine.ts";
import { buildLearningTasks } from "./learning-tasks.ts";

export const commandCoverageSchemaVersion = 1 as const;

export type CommandCoverageClassification =
  | "learning-task"
  | "contextual-help-only"
  | "administrator-added";

export interface CommandInventoryChange {
  id: string;
  action: "corrected" | "removed";
  previousCanonical: string;
  replacementId?: string;
  migration: string;
}

export interface CommandCoverageProduction {
  id: string;
  profile: DeviceProfileId;
  context: RegistryContext;
  canonical: string;
  signature: string;
  kind: Command["kind"];
  topic: string;
  aliases: readonly string[];
  classification: CommandCoverageClassification;
  hasLearningTask: boolean;
  supplemental: boolean;
  administratorAdded: boolean;
}

export interface CommandCoverageReport {
  schemaVersion: typeof commandCoverageSchemaVersion;
  scope: "CLI RUSH deterministic simulator command set";
  inventory: {
    builtInLearningObjectives: number;
    builtInDistinctCanonicalCommands: number;
    builtInCliModes: number;
    builtInTopics: number;
    administratorActiveCommands: number;
    supportedLogicalProductions: number;
    supportedProfileContextProductions: number;
    supportedDistinctCommandIds: number;
    supportedDistinctCanonicalCommands: number;
  };
  classifications: {
    logicalProductions: CommandCoverageClassificationTotals;
    profileContextProductions: CommandCoverageClassificationTotals;
  };
  byProfile: Readonly<Record<DeviceProfileId, number>>;
  byContext: Readonly<Record<string, number>>;
  documentedInventoryChanges: readonly CommandInventoryChange[];
  productions: readonly CommandCoverageProduction[];
}

export interface CommandCoverageClassificationTotals {
  learningTask: number;
  contextualHelpOnly: number;
  administratorAdded: number;
}

export interface CommandCoverageOptions {
  customCommands?: readonly CustomCommandRecord[];
  documentedInventoryChanges?: readonly CommandInventoryChange[];
}

export interface CommandInventoryBaseline {
  learningObjectives: number;
  distinctCanonicalCommands: number;
  cliModes: number;
  topics: number;
}

/**
 * Release baseline asserted by AGENTS.md. This is validation metadata and is
 * deliberately not imported by the player interface.
 */
export const commandInventoryBaseline: Readonly<CommandInventoryBaseline> = Object.freeze({
  learningObjectives: 214,
  distinctCanonicalCommands: 203,
  cliModes: 9,
  topics: 25,
});

const normaliseCanonical = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");

const compareText = (left: string, right: string): number =>
  left.localeCompare(right, "en-GB", { sensitivity: "base" });

const activeCustomCommands = (
  records: readonly CustomCommandRecord[],
): ActiveCustomCommand[] => records.filter(
  (record): record is ActiveCustomCommand => record.status === "active",
);

const countBy = <T>(values: readonly T[], keyFor: (value: T) => string): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => compareText(left, right)));
};

const classificationTotals = (
  counts: Readonly<Record<string, number>>,
): CommandCoverageClassificationTotals => ({
  learningTask: counts["learning-task"] ?? 0,
  contextualHelpOnly: counts["contextual-help-only"] ?? 0,
  administratorAdded: counts["administrator-added"] ?? 0,
});

const validateInventoryChanges = (changes: readonly CommandInventoryChange[]): CommandInventoryChange[] =>
  changes.map((change) => {
    if (!change.id.trim() || !change.previousCanonical.trim() || !change.migration.trim()) {
      throw new Error("Documented command corrections and removals require an ID, previous canonical command and migration note.");
    }
    return {
      id: change.id.trim(),
      action: change.action,
      previousCanonical: change.previousCanonical.trim().replace(/\s+/gu, " "),
      ...(change.replacementId?.trim() ? { replacementId: change.replacementId.trim() } : {}),
      migration: change.migration.trim(),
    };
  }).sort((left, right) => compareText(left.id, right.id));

const ensureUniqueAdministratorIds = (
  builtIns: readonly Command[],
  administratorCommands: readonly ActiveCustomCommand[],
): void => {
  const known = new Set(builtIns.map((command) => command.id));
  for (const command of administratorCommands) {
    if (known.has(command.id)) {
      throw new Error(`Administrator command ID ${command.id} collides with another supported command.`);
    }
    known.add(command.id);
  }
};

const profilesForProduction = (
  production: CommandProduction,
  administratorById: ReadonlyMap<string, ActiveCustomCommand>,
): readonly DeviceProfileId[] => {
  const administratorCommand = administratorById.get(production.command.id);
  return administratorCommand ? [administratorCommand.deviceProfile] : production.profileIds;
};

const classificationFor = (
  production: CommandProduction,
  administratorIds: ReadonlySet<string>,
  learningTaskIds: ReadonlySet<string>,
): CommandCoverageClassification => {
  if (administratorIds.has(production.command.id)) return "administrator-added";
  if (production.supplemental) return "contextual-help-only";
  if (learningTaskIds.has(production.command.id)) return "learning-task";
  throw new Error(`Registry production ${production.command.id} has neither a learning task nor a deliberate supplemental classification.`);
};

/**
 * Derive an auditable inventory from the same registry used by parsing, help
 * and completion. Incomplete legacy/custom drafts are intentionally excluded:
 * only administrator records that have passed validation and are active can
 * become supported productions.
 */
export const generateCommandCoverage = (
  catalogue: readonly Command[],
  options: CommandCoverageOptions = {},
): CommandCoverageReport => {
  const builtIns = catalogue.filter((command) => !command.custom);
  const administratorCommands = activeCustomCommands(options.customCommands ?? []);
  ensureUniqueAdministratorIds(builtIns, administratorCommands);

  const builtInTasks = buildLearningTasks(builtIns);
  const learningTaskIds = new Set([
    ...builtInTasks.map((task) => task.commandId),
    ...administratorCommands.map((command) => command.id),
  ]);
  const administratorIds = new Set(administratorCommands.map((command) => command.id));
  const administratorById = new Map(administratorCommands.map((command) => [command.id, command]));
  const registry = buildCommandRegistry(
    [...builtIns, ...administratorCommands],
    getDeviceProfile("router-ios-xe"),
    { allProfiles: true },
  );

  const productions: CommandCoverageProduction[] = registry.productions.flatMap((production) => {
    const classification = classificationFor(production, administratorIds, learningTaskIds);
    return profilesForProduction(production, administratorById).map((profile) => ({
      id: production.command.id,
      profile,
      context: production.context,
      canonical: production.command.canonical,
      signature: production.signature,
      kind: production.command.kind,
      topic: production.command.topic,
      aliases: [...(production.aliases ?? [])].sort(compareText),
      classification,
      hasLearningTask: learningTaskIds.has(production.command.id),
      supplemental: production.supplemental === true,
      administratorAdded: administratorIds.has(production.command.id),
    }));
  }).sort((left, right) =>
    compareText(left.profile, right.profile)
    || compareText(left.context, right.context)
    || compareText(left.canonical, right.canonical)
    || compareText(left.id, right.id));

  const logicalCanonicalCommands = new Set(
    registry.productions.map((production) => normaliseCanonical(production.command.canonical)),
  );
  const supportedCommandIds = new Set(registry.productions.map((production) => production.command.id));
  const classifications = countBy(productions, (production) => production.classification);
  const logicalClassifications = countBy(
    registry.productions,
    (production) => classificationFor(production, administratorIds, learningTaskIds),
  );
  const byProfile = Object.fromEntries(
    (Object.keys(deviceProfiles) as DeviceProfileId[]).map((profile) => [
      profile,
      productions.filter((production) => production.profile === profile).length,
    ]),
  ) as Record<DeviceProfileId, number>;

  return {
    schemaVersion: commandCoverageSchemaVersion,
    scope: "CLI RUSH deterministic simulator command set",
    inventory: {
      builtInLearningObjectives: builtInTasks.length,
      builtInDistinctCanonicalCommands: new Set(builtIns.map((command) => normaliseCanonical(command.canonical))).size,
      builtInCliModes: new Set(builtIns.map((command) => command.mode)).size,
      builtInTopics: new Set(builtIns.map((command) => command.topic)).size,
      administratorActiveCommands: administratorCommands.length,
      supportedLogicalProductions: registry.productions.length,
      supportedProfileContextProductions: productions.length,
      supportedDistinctCommandIds: supportedCommandIds.size,
      supportedDistinctCanonicalCommands: logicalCanonicalCommands.size,
    },
    classifications: {
      logicalProductions: classificationTotals(logicalClassifications),
      profileContextProductions: classificationTotals(classifications),
    },
    byProfile,
    byContext: countBy(productions, (production) => production.context),
    documentedInventoryChanges: validateInventoryChanges(options.documentedInventoryChanges ?? []),
    productions,
  };
};

export const assertCommandInventoryBaseline = (
  report: CommandCoverageReport,
  baseline: Readonly<CommandInventoryBaseline> = commandInventoryBaseline,
): void => {
  const actual: CommandInventoryBaseline = {
    learningObjectives: report.inventory.builtInLearningObjectives,
    distinctCanonicalCommands: report.inventory.builtInDistinctCanonicalCommands,
    cliModes: report.inventory.builtInCliModes,
    topics: report.inventory.builtInTopics,
  };
  for (const key of Object.keys(baseline) as (keyof CommandInventoryBaseline)[]) {
    if (actual[key] !== baseline[key]) {
      throw new Error(`Built-in command inventory regression for ${key}: expected ${baseline[key]}, received ${actual[key]}.`);
    }
  }
};
