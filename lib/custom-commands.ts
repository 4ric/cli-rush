import {
  cliHelp,
  completeCliInput,
  type CliHelpOption,
} from "./cli-assistance.ts";
import {
  buildCommandRegistry,
  grammarTokensForCommand,
  parseRegistryInput,
  productionAvailableInContext,
  type RegistryCommand,
  type RegistryToken,
} from "./command-registry.ts";
import {
  deviceProfiles,
  getDeviceProfile,
  type DeviceProfileId,
} from "./device-profiles.ts";
import type { CliMode, Command, CommandKind } from "./engine.ts";

/**
 * Semantic custom content remains inert JSON. This module only validates and
 * projects data into the deterministic command registry; it never dispatches
 * command text to a shell, evaluator, device or simulator state mutator.
 */

export const customCommandSchemaVersion = 2 as const;

export const customCommandLimits = Object.freeze({
  id: 100,
  canonical: 256,
  canonicalTokens: 32,
  canonicalToken: 80,
  objective: 300,
  explanation: 600,
  topic: 80,
  helpDescription: 240,
  effect: 600,
  why: 600,
  progressiveHints: 3,
  progressiveHint: 300,
  revealExplanation: 600,
  verification: 500,
  undo: 500,
  tags: 12,
  tag: 40,
  prerequisites: 20,
  prerequisite: 100,
});

const cliModes: readonly CliMode[] = [
  "user",
  "privileged",
  "global",
  "interface",
  "router",
  "line",
  "vlan",
  "acl",
  "dhcp",
];

const commandKinds: readonly CommandKind[] = ["navigation", "verification", "configuration"];

const contextLabels: Readonly<Record<CliMode, string>> = {
  user: "User EXEC",
  privileged: "Privileged EXEC",
  global: "Global configuration",
  interface: "Interface configuration",
  router: "Router configuration",
  line: "Line configuration",
  vlan: "VLAN configuration",
  acl: "Named ACL configuration",
  dhcp: "DHCP pool configuration",
};

export interface CustomCommandReadOnlyEffect {
  type: "read-only";
  /** The observable result; this is descriptive text, never executable code. */
  result: string;
}

export interface CustomCommandStateChangeEffect {
  type: "state-change";
  /** The deterministic state change expected from the command. */
  description: string;
}

export type CustomCommandEffect = CustomCommandReadOnlyEffect | CustomCommandStateChangeEffect;

export interface CustomCommandSemantics {
  helpDescription: string;
  effect: CustomCommandEffect;
  why: string;
  progressiveHints: readonly string[];
  revealExplanation: string;
  verification?: string;
  undo?: string;
  tags: readonly string[];
  prerequisites: readonly string[];
}

export interface CustomCommandSemanticsDraft {
  helpDescription: string;
  effect: CustomCommandEffect | null;
  why: string;
  progressiveHints: readonly string[];
  revealExplanation: string;
  verification?: string;
  undo?: string;
  tags: readonly string[];
  prerequisites: readonly string[];
}

export interface CustomCommandDraft {
  schemaVersion: typeof customCommandSchemaVersion;
  status: "draft";
  legacy: false;
  deviceProfile: DeviceProfileId | string;
  id: string;
  mode: CliMode | string;
  canonical: string;
  objective: string;
  explanation: string;
  topic: string;
  difficulty: number;
  kind: CommandKind | string;
  custom: true;
  semantics: CustomCommandSemanticsDraft;
}

export interface ActiveCustomCommand extends Command {
  schemaVersion: typeof customCommandSchemaVersion;
  status: "active";
  legacy: false;
  deviceProfile: DeviceProfileId;
  custom: true;
  semantics: CustomCommandSemantics;
}

export interface IncompleteCustomCommand {
  schemaVersion: typeof customCommandSchemaVersion;
  status: "incomplete";
  legacy: boolean;
  deviceProfile: DeviceProfileId | null;
  id: string;
  mode: string;
  canonical: string;
  objective: string;
  explanation: string;
  topic: string;
  difficulty: number;
  kind: string;
  custom: true;
  semantics: CustomCommandSemanticsDraft;
  issues: readonly CustomCommandIssue[];
  /** Present when this record originated from the flat version-1 shape. */
  legacySource?: unknown;
}

export interface LegacyCustomCommand extends IncompleteCustomCommand {
  legacy: true;
  deviceProfile: null;
  /** The original value is retained verbatim so migration never deletes data. */
  legacySource: unknown;
}

export type CustomCommandRecord = ActiveCustomCommand | IncompleteCustomCommand;

export type CustomCommandIssueCode =
  | "INVALID_RECORD"
  | "SCHEMA_VERSION"
  | "LEGACY_INCOMPLETE"
  | "INCOMPLETE_REVIEW"
  | "REQUIRED"
  | "TOO_LONG"
  | "UNSAFE_TEXT"
  | "INVALID_ID"
  | "INVALID_PROFILE"
  | "INVALID_CONTEXT"
  | "INVALID_KIND"
  | "INVALID_DIFFICULTY"
  | "INVALID_CANONICAL"
  | "INVALID_LIST"
  | "INVALID_EFFECT"
  | "KIND_EFFECT_MISMATCH"
  | "PROFILE_CONTEXT_MISMATCH"
  | "PROFILE_COMMAND_MISMATCH"
  | "ID_COLLISION"
  | "EXACT_COLLISION"
  | "COMMAND_TREE_COLLISION"
  | "AMBIGUOUS_KEYWORD"
  | "PARSER_REJECTED"
  | "UNDO_RECOMMENDED";

export interface CustomCommandIssue {
  code: CustomCommandIssueCode;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface CustomCommandQuestionMarkPreview {
  /** Text immediately before the previewed `?`. */
  input: string;
  options: readonly CliHelpOption[];
  commandOption: CliHelpOption | null;
  message: string;
}

export interface CustomCommandTabPreview {
  input: string;
  output: string;
  changed: boolean;
  assisted: boolean;
  message: string;
}

export interface CustomCommandPreview {
  helpDescription: string;
  grammar: readonly RegistryToken[];
  questionMark: CustomCommandQuestionMarkPreview;
  tab: CustomCommandTabPreview;
  /** Parser-proven IOS keyword abbreviations; canonical values are unchanged. */
  shorthandExamples: readonly string[];
}

export interface CustomCommandValidationOptions {
  /** Built-ins and already-active custom records, excluding the draft itself. */
  catalogue?: readonly RegistryCommand[];
}

export type CustomCommandValidation =
  | {
      ok: true;
      active: ActiveCustomCommand;
      command: Command;
      preview: CustomCommandPreview;
      warnings: readonly CustomCommandIssue[];
    }
  | {
      ok: false;
      draft?: CustomCommandDraft;
      errors: readonly CustomCommandIssue[];
      warnings: readonly CustomCommandIssue[];
    };

export interface BasicCustomCommandInput {
  deviceProfile: DeviceProfileId;
  context: CliMode;
  canonical: string;
  task: string;
  explanation: string;
  id?: string;
}

export interface AdvancedCustomCommandInput extends BasicCustomCommandInput {
  kind: CommandKind;
  topic?: string;
  difficulty: 1 | 2 | 3;
  helpDescription: string;
  effect: CustomCommandEffect;
  why: string;
  progressiveHints: readonly string[];
  revealExplanation: string;
  verification?: string;
  undo?: string;
  tags: readonly string[];
  prerequisites: readonly string[];
}

export interface CustomCommandMigrationResult {
  records: readonly CustomCommandRecord[];
  storeIssues: readonly CustomCommandIssue[];
}

const issue = (
  code: CustomCommandIssueCode,
  field: string,
  message: string,
  severity: CustomCommandIssue["severity"] = "error",
): CustomCommandIssue => ({ code, field, message, severity });

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");
const normaliseCanonical = (value: string): string => value.trim().replace(/\s+/gu, " ");

// U+000A is permitted in prose fields. All other C0/C1 controls, DEL and
// Unicode bidirectional formatting controls are rejected before activation.
const forbiddenProse = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const forbiddenSingleLine = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

// The bounded grammar deliberately excludes shell/evaluator separators and
// grouping punctuation. Visible prose is not filtered this way and remains
// inert text, including markup-like strings.
const canonicalCharacters = /^[\p{L}\p{N}][\p{L}\p{N} .,:\/_@#'%+*=-]*$/u;

const missing = Symbol("missing-data-property");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read JSON-like own data without invoking an accessor supplied by input. */
const ownData = (record: Record<string, unknown>, key: string): unknown | typeof missing => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : missing;
};

const asString = (value: unknown | typeof missing): string => typeof value === "string" ? value : "";

const textField = (
  record: Record<string, unknown>,
  field: string,
  label: string,
  maximum: number,
  issues: CustomCommandIssue[],
  options: Readonly<{ required?: boolean; multiline?: boolean }> = {},
): string => {
  const value = ownData(record, field);
  if (typeof value !== "string") {
    if (options.required ?? true) issues.push(issue("REQUIRED", field, `${label} is required.`));
    return "";
  }
  const lineNormalised = value.replace(/\r\n?/gu, "\n");
  const unsafe = options.multiline ? forbiddenProse : forbiddenSingleLine;
  if (unsafe.test(lineNormalised)) {
    issues.push(issue("UNSAFE_TEXT", field, `${label} cannot contain control or bidirectional formatting characters.`));
  }
  const result = lineNormalised.trim();
  if ((options.required ?? true) && !result) issues.push(issue("REQUIRED", field, `${label} is required.`));
  if (result.length > maximum) {
    issues.push(issue("TOO_LONG", field, `${label} must be ${maximum} characters or fewer.`));
  }
  return result;
};

const optionalTextField = (
  record: Record<string, unknown>,
  field: string,
  label: string,
  maximum: number,
  issues: CustomCommandIssue[],
): string | undefined => {
  const value = ownData(record, field);
  if (value === missing || value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    issues.push(issue("INVALID_RECORD", field, `${label} must be text when supplied.`));
    return undefined;
  }
  const wrapper: Record<string, unknown> = { [field]: value };
  return textField(wrapper, field, label, maximum, issues, { multiline: true });
};

const listField = (
  record: Record<string, unknown>,
  field: string,
  label: string,
  itemMaximum: number,
  maximumItems: number,
  issues: CustomCommandIssue[],
  minimumItems = 0,
): string[] => {
  const value = ownData(record, field);
  if (!Array.isArray(value)) {
    issues.push(issue("INVALID_LIST", field, `${label} must be supplied as a list${minimumItems ? " with at least one item" : " (it may be empty)"}.`));
    return [];
  }
  if (value.length < minimumItems) {
    issues.push(issue("REQUIRED", field, `${label} must contain at least one item.`));
  }
  if (value.length > maximumItems) {
    issues.push(issue("INVALID_LIST", field, `${label} can contain at most ${maximumItems} items.`));
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.min(value.length, maximumItems); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const item = descriptor && "value" in descriptor ? descriptor.value : missing;
    const path = `${field}.${index}`;
    if (typeof item !== "string") {
      issues.push(issue("INVALID_LIST", path, `${label} entries must be text.`));
      continue;
    }
    const normalised = item.replace(/\r\n?/gu, "\n").trim();
    if (!normalised) {
      issues.push(issue("REQUIRED", path, `${label} entries cannot be empty.`));
      continue;
    }
    if (forbiddenProse.test(normalised)) {
      issues.push(issue("UNSAFE_TEXT", path, `${label} entries cannot contain control or bidirectional formatting characters.`));
    }
    if (normalised.length > itemMaximum) {
      issues.push(issue("TOO_LONG", path, `${label} entries must be ${itemMaximum} characters or fewer.`));
    }
    const key = lower(normalised);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalised);
    }
  }
  return result;
};

const stableHash = (value: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const generatedId = (input: BasicCustomCommandInput): string => {
  const source = [input.deviceProfile, input.context, normaliseCanonical(input.canonical), input.task.trim()].join("\u001f");
  return `custom.${stableHash(source, 0x811c9dc5)}${stableHash(source, 0x9e3779b9)}`;
};

const switchCommand = /^(?:switchport|spanning-tree|channel-group|storm-control|vlan|ip dhcp snooping|ip arp inspection|show (?:vlan|mac address-table|spanning-tree|etherchannel|lacp|pagp|port-security|interfaces? (?:status|switchport|trunk)))(?:\s|$)/iu;
const routerCommand = /^(?:router|ip route|ipv6 route|ip nat|ip dhcp (?!snooping)|show ip (?:route|ospf|nat)|show ipv6 route)(?:\s|$)/iu;

const inferredTopic = (canonical: string, mode: CliMode): string => {
  const command = normaliseCanonical(canonical);
  if (mode === "vlan" || switchCommand.test(command)) return "Layer 2 switching";
  if (mode === "router" || routerCommand.test(command)) return "Routing";
  if (mode === "dhcp") return "DHCP";
  return "Custom";
};

const looksReadOnly = (canonical: string): boolean =>
  /^(?:show|ping|traceroute)(?:\s|$)/iu.test(normaliseCanonical(canonical));

const provisionalCommand = (input: BasicCustomCommandInput): Command => ({
  id: input.id ?? generatedId(input),
  mode: input.context,
  canonical: normaliseCanonical(input.canonical),
  objective: input.task.trim(),
  explanation: input.explanation.trim(),
  topic: inferredTopic(input.canonical, input.context),
  difficulty: 1,
  kind: "verification",
  custom: true,
});

const defaultHints = (command: Command): string[] => {
  const grammar = grammarTokensForCommand(command);
  const firstKeyword = grammar.find((token) => token.kind === "keyword")?.source ?? "the command keyword";
  const shape = grammar.map((token) => token.kind === "keyword" ? token.source : token.display).join(" ");
  return [
    `Use ${contextLabels[command.mode]} mode.`,
    `Begin with the “${firstKeyword}” command family.`,
    `Build the grammar: ${shape}.`,
  ];
};

export const createBasicCustomCommand = (input: BasicCustomCommandInput): CustomCommandDraft => {
  const command = provisionalCommand(input);
  const readOnly = looksReadOnly(command.canonical);
  return {
    schemaVersion: customCommandSchemaVersion,
    status: "draft",
    legacy: false,
    deviceProfile: input.deviceProfile,
    ...command,
    custom: true,
    semantics: {
      helpDescription: command.objective,
      effect: readOnly ? { type: "read-only", result: command.explanation } : null,
      why: command.explanation,
      progressiveHints: defaultHints(command),
      revealExplanation: command.explanation,
      tags: readOnly ? ["custom", "read-only"] : ["custom"],
      prerequisites: [],
    },
  };
};

export const createAdvancedCustomCommand = (input: AdvancedCustomCommandInput): CustomCommandDraft => ({
  schemaVersion: customCommandSchemaVersion,
  status: "draft",
  legacy: false,
  deviceProfile: input.deviceProfile,
  id: input.id ?? generatedId(input),
  mode: input.context,
  canonical: normaliseCanonical(input.canonical),
  objective: input.task.trim(),
  explanation: input.explanation.trim(),
  topic: input.topic?.trim() || inferredTopic(input.canonical, input.context),
  difficulty: input.difficulty,
  kind: input.kind,
  custom: true,
  semantics: {
    helpDescription: input.helpDescription.trim(),
    effect: input.effect,
    why: input.why.trim(),
    progressiveHints: [...input.progressiveHints],
    revealExplanation: input.revealExplanation.trim(),
    ...(input.verification?.trim() ? { verification: input.verification.trim() } : {}),
    ...(input.undo?.trim() ? { undo: input.undo.trim() } : {}),
    tags: [...input.tags],
    prerequisites: [...input.prerequisites],
  },
});

const commandForProfile = (command: RegistryCommand, profileId: DeviceProfileId): boolean => {
  if (!isRecord(command)) return true;
  const declared = ownData(command, "deviceProfile");
  return declared === missing || declared === undefined || declared === profileId;
};

const catalogueForProfile = (
  catalogue: readonly RegistryCommand[],
  profileId: DeviceProfileId,
): RegistryCommand[] => catalogue.filter((command) => commandForProfile(command, profileId));

const toCommand = (active: ActiveCustomCommand): Command => ({
  id: active.id,
  mode: active.mode,
  canonical: active.canonical,
  objective: active.objective,
  explanation: active.explanation,
  topic: active.topic,
  difficulty: active.difficulty,
  kind: active.kind,
  custom: true,
  deviceProfile: active.deviceProfile,
});

export const toRegistryCommand = (record: CustomCommandRecord): Command | null =>
  record.status === "active" ? toCommand(record) : null;

/** Derive only active commands for the selected virtual device profile. */
export const customCommandsForProfile = (
  records: readonly CustomCommandRecord[],
  profileId: DeviceProfileId,
): Command[] => records
  .filter((record): record is ActiveCustomCommand => record.status === "active" && record.deviceProfile === profileId)
  .map(toCommand);

const treeNode = (token: RegistryToken): string => token.kind === "keyword"
  ? `k:${lower(token.source)}`
  : `a:${token.argumentKind}:${token.rest ? "rest" : "one"}:${token.caseSensitive ? "case" : "fold"}`;

const treeKey = (tokens: readonly RegistryToken[]): string => tokens.map(treeNode).join("/");

const sameTreePrefix = (
  candidate: readonly RegistryToken[],
  existing: readonly RegistryToken[],
  count: number,
): boolean => {
  if (candidate.length < count || existing.length < count) return false;
  for (let index = 0; index < count; index += 1) {
    if (treeNode(candidate[index]) !== treeNode(existing[index])) return false;
  }
  return true;
};

const ambiguousCanonicalKeyword = (
  candidate: readonly RegistryToken[],
  existingTokens: readonly (readonly RegistryToken[])[],
): { abbreviated: string; existing: string } | null => {
  for (const existing of existingTokens) {
    const limit = Math.min(candidate.length, existing.length);
    for (let index = 0; index < limit; index += 1) {
      if (!sameTreePrefix(candidate, existing, index)) break;
      const proposed = candidate[index];
      const current = existing[index];
      if (treeNode(proposed) === treeNode(current)) continue;
      if (proposed.kind === "keyword" && current.kind === "keyword"
        && lower(current.source).startsWith(lower(proposed.source))
        && lower(current.source) !== lower(proposed.source)) {
        const alreadyDeclared = existingTokens.some((tokens) =>
          sameTreePrefix(candidate, tokens, index)
          && tokens[index]?.kind === "keyword"
          && lower(tokens[index].source) === lower(proposed.source));
        if (!alreadyDeclared) return { abbreviated: proposed.source, existing: current.source };
      }
      break;
    }
  }
  return null;
};

const profileContextMessage = (profileId: DeviceProfileId, mode: CliMode): string | null => {
  if (profileId === "router-ios-xe" && mode === "vlan") {
    return `${contextLabels[mode]} mode is not available on the IOS XE training router profile.`;
  }
  if (profileId === "catalyst-l2" && (mode === "router" || mode === "dhcp")) {
    return `${contextLabels[mode]} mode is not available on the Catalyst Layer 2 training switch profile.`;
  }
  return null;
};

const profileCommandMessage = (profileId: DeviceProfileId, canonical: string): string | null => {
  const role = switchCommand.test(canonical) ? "switch" : routerCommand.test(canonical) ? "router" : null;
  if (role === "switch" && profileId !== "catalyst-l2") {
    return "This command requires switching capabilities. Select the Catalyst Layer 2 training switch profile or change the command.";
  }
  if (role === "router" && profileId !== "router-ios-xe") {
    return "This command requires routing capabilities. Select the IOS XE training router profile or change the command.";
  }
  return null;
};

const grammarErrors = (canonical: string, issues: CustomCommandIssue[]): string => {
  const normalised = normaliseCanonical(canonical);
  if (!normalised) {
    issues.push(issue("REQUIRED", "canonical", "Canonical command is required."));
    return normalised;
  }
  if (canonical.length > customCommandLimits.canonical) {
    issues.push(issue("TOO_LONG", "canonical", `Canonical command must be ${customCommandLimits.canonical} characters or fewer.`));
  }
  if (forbiddenSingleLine.test(canonical)) {
    issues.push(issue("UNSAFE_TEXT", "canonical", "Canonical command cannot contain control or bidirectional formatting characters."));
  }
  if (!canonicalCharacters.test(normalised)) {
    issues.push(issue(
      "INVALID_CANONICAL",
      "canonical",
      "Use bounded IOS command tokens only; shell separators, evaluator punctuation, brackets and angle brackets are not supported.",
    ));
  }
  const tokens = normalised.split(" ");
  if (tokens.length > customCommandLimits.canonicalTokens) {
    issues.push(issue("INVALID_CANONICAL", "canonical", `Canonical command can contain at most ${customCommandLimits.canonicalTokens} tokens.`));
  }
  if (tokens.some((token) => token.length > customCommandLimits.canonicalToken)) {
    issues.push(issue("INVALID_CANONICAL", "canonical", `Each canonical token must be ${customCommandLimits.canonicalToken} characters or fewer.`));
  }
  return normalised;
};

const parseEffect = (
  semantics: Record<string, unknown>,
  issues: CustomCommandIssue[],
): CustomCommandEffect | null => {
  const value = ownData(semantics, "effect");
  if (!isRecord(value)) {
    issues.push(issue(
      "INVALID_EFFECT",
      "semantics.effect",
      "Choose an explicit read-only result or describe the state change. Configuration behaviour is never inferred.",
    ));
    return null;
  }
  const type = ownData(value, "type");
  if (type === "read-only") {
    const result = textField(value, "result", "Read-only result", customCommandLimits.effect, issues, { multiline: true });
    return { type, result };
  }
  if (type === "state-change") {
    const description = textField(value, "description", "State effect", customCommandLimits.effect, issues, { multiline: true });
    return { type, description };
  }
  issues.push(issue("INVALID_EFFECT", "semantics.effect.type", "Effect type must be “read-only” or “state-change”."));
  return null;
};

const activeFromDraft = (
  draft: CustomCommandDraft,
  profileId: DeviceProfileId,
  mode: CliMode,
  kind: CommandKind,
  difficulty: 1 | 2 | 3,
  semantics: CustomCommandSemantics,
): ActiveCustomCommand => ({
  schemaVersion: customCommandSchemaVersion,
  status: "active",
  legacy: false,
  deviceProfile: profileId,
  id: draft.id,
  mode,
  canonical: draft.canonical,
  objective: draft.objective,
  explanation: draft.explanation,
  topic: draft.topic,
  difficulty,
  kind,
  custom: true,
  semantics,
});

const parserAndCollisionIssues = (
  active: ActiveCustomCommand,
  catalogue: readonly RegistryCommand[],
): CustomCommandIssue[] => {
  const errors: CustomCommandIssue[] = [];
  const profile = getDeviceProfile(active.deviceProfile);
  const existingCatalogue = catalogueForProfile(catalogue, active.deviceProfile);
  if (existingCatalogue.some((command) => command.id === active.id)) {
    errors.push(issue("ID_COLLISION", "id", `Command ID “${active.id}” is already in use. Generate a new custom command ID.`));
  }

  const candidateCommand = toCommand(active);
  const candidateRegistry = buildCommandRegistry([candidateCommand], profile, { includeSupplemental: false });
  const candidateProduction = candidateRegistry.productions[0];
  if (!candidateProduction.profileIds.includes(active.deviceProfile)) {
    errors.push(issue(
      "PROFILE_COMMAND_MISMATCH",
      "deviceProfile",
      `The shared command registry does not expose this grammar on ${profile.label}. Choose the matching profile or revise the command and topic.`,
    ));
    return errors;
  }

  const existingRegistry = buildCommandRegistry(existingCatalogue, profile);
  const relevant = existingRegistry.productions.filter((production) =>
    productionAvailableInContext(existingRegistry, production, active.mode));
  const candidateKey = treeKey(candidateProduction.tokens);
  const collision = relevant.find((production) => treeKey(production.tokens) === candidateKey);
  if (collision) {
    const exact = lower(normaliseCanonical(collision.command.canonical)) === lower(active.canonical);
    errors.push(issue(
      exact ? "EXACT_COLLISION" : "COMMAND_TREE_COLLISION",
      "canonical",
      exact
        ? `“${active.canonical}” already exists in ${contextLabels[active.mode]} mode for this profile. Edit the existing entry instead of adding a second meaning.`
        : `This grammar is already owned by “${collision.command.canonical}” in ${contextLabels[active.mode]} mode. Use that command entry or choose a distinct command tree.`,
    ));
  }

  const keywordAmbiguity = ambiguousCanonicalKeyword(
    candidateProduction.tokens,
    relevant.map((production) => production.tokens),
  );
  if (keywordAmbiguity) {
    errors.push(issue(
      "AMBIGUOUS_KEYWORD",
      "canonical",
      `“${keywordAmbiguity.abbreviated}” is only a prefix of the existing “${keywordAmbiguity.existing}” keyword at this command-tree branch. Enter the full IOS keyword instead.`,
    ));
  }

  if (errors.some((entry) => entry.code === "EXACT_COLLISION" || entry.code === "COMMAND_TREE_COLLISION")) {
    return errors;
  }

  const combined = buildCommandRegistry([...existingCatalogue, candidateCommand], profile);
  const parsed = parseRegistryInput(combined, active.canonical, active.mode);
  if (parsed.status !== "valid") {
    const detail = parsed.status === "ambiguous"
      ? ` It matches: ${parsed.matches.map((match) => match.command.canonical).sort().join(", ")}.`
      : ` ${parsed.message}`;
    errors.push(issue(
      "PARSER_REJECTED",
      "canonical",
      `The shared parser cannot register this command unambiguously in ${contextLabels[active.mode]} mode.${detail}`,
    ));
  } else if (parsed.event.command.id !== active.id) {
    errors.push(issue(
      "COMMAND_TREE_COLLISION",
      "canonical",
      `The shared parser resolves this grammar to “${parsed.event.command.canonical}”. Choose a distinct command tree.`,
    ));
  }
  return errors;
};

const validAbbreviation = (
  registry: ReturnType<typeof buildCommandRegistry>,
  input: string,
  command: ActiveCustomCommand,
): boolean => {
  const parsed = parseRegistryInput(registry, input, command.mode);
  return parsed.status === "valid" && parsed.event.command.id === command.id;
};

const shorthandExamples = (
  active: ActiveCustomCommand,
  catalogue: readonly RegistryCommand[],
): string[] => {
  const command = toCommand(active);
  const filtered = catalogueForProfile(catalogue, active.deviceProfile).filter((entry) => entry.id !== active.id);
  const registry = buildCommandRegistry([...filtered, command], getDeviceProfile(active.deviceProfile));
  const grammar = grammarTokensForCommand(command);
  const source = grammar.map((token) => token.source);
  const candidates = new Set<string>();
  const add = (values: readonly string[]) => {
    const value = values.join(" ");
    if (lower(value) !== lower(command.canonical) && validAbbreviation(registry, value, active)) candidates.add(value);
  };

  for (let tokenAt = 0; tokenAt < grammar.length; tokenAt += 1) {
    const token = grammar[tokenAt];
    if (token.kind !== "keyword" || token.source.length < 2) continue;
    for (let length = 1; length < token.source.length; length += 1) {
      const values = [...source];
      values[tokenAt] = token.source.slice(0, length);
      if (validAbbreviation(registry, values.join(" "), active)) {
        add(values);
        break;
      }
    }
  }

  const greedy = (order: readonly number[]) => {
    const values = [...source];
    for (const tokenAt of order) {
      const token = grammar[tokenAt];
      if (token.kind !== "keyword" || token.source.length < 2) continue;
      for (let length = 1; length < token.source.length; length += 1) {
        const attempt = [...values];
        attempt[tokenAt] = token.source.slice(0, length);
        if (validAbbreviation(registry, attempt.join(" "), active)) {
          values[tokenAt] = attempt[tokenAt];
          break;
        }
      }
    }
    add(values);
  };
  const positions = grammar.map((_, index) => index);
  greedy(positions);
  greedy([...positions].reverse());

  return [...candidates]
    .sort((left, right) => left.length - right.length || left.localeCompare(right, "en-GB"))
    .slice(0, 3);
};

const tabPreview = (
  active: ActiveCustomCommand,
  catalogue: readonly RegistryCommand[],
  grammar: readonly RegistryToken[],
): CustomCommandTabPreview => {
  const command = toCommand(active);
  const filtered = catalogueForProfile(catalogue, active.deviceProfile).filter((entry) => entry.id !== active.id);
  const combined = [...filtered, command];
  let keywordAt = -1;
  for (let index = grammar.length - 1; index >= 0; index -= 1) {
    if (grammar[index].kind === "keyword") {
      keywordAt = index;
      break;
    }
  }
  if (keywordAt < 0) {
    return {
      input: "",
      output: "",
      changed: false,
      assisted: false,
      message: "Tab cannot complete a command whose first node is a variable value.",
    };
  }
  const keyword = grammar[keywordAt] as Extract<RegistryToken, { kind: "keyword" }>;
  const before = grammar.slice(0, keywordAt).map((token) => token.source);
  let selectedInput = [...before, keyword.source].join(" ");
  let selected = completeCliInput(selectedInput, active.mode, combined, active.deviceProfile);
  for (let length = 1; length < keyword.source.length; length += 1) {
    const input = [...before, keyword.source.slice(0, length)].join(" ");
    const completion = completeCliInput(input, active.mode, combined, active.deviceProfile);
    const expected = [...before, keyword.source].join(" ");
    if (completion.changed && (completion.input.trimEnd() === expected || completion.input.startsWith(`${expected} `))) {
      selectedInput = input;
      selected = completion;
      break;
    }
  }
  return {
    input: selectedInput,
    output: selected.input,
    changed: selected.changed,
    assisted: selected.assisted,
    message: selected.message,
  };
};

export const previewCustomCommand = (
  active: ActiveCustomCommand,
  catalogue: readonly RegistryCommand[] = [],
): CustomCommandPreview => {
  const command = toCommand(active);
  const filtered = catalogueForProfile(catalogue, active.deviceProfile).filter((entry) => entry.id !== active.id);
  const combined = [...filtered, command];
  const grammar = grammarTokensForCommand(command);
  const parent = grammar.slice(0, -1).map((token) => token.source).join(" ");
  const helpInput = parent ? `${parent} ` : "";
  const help = cliHelp(helpInput, active.mode, combined, active.deviceProfile);
  const target = grammar.at(-1)?.display ?? "";
  const commandOption = help.options.find((option) => lower(option.value) === lower(target)) ?? null;
  return {
    helpDescription: active.semantics.helpDescription,
    grammar,
    questionMark: {
      input: helpInput,
      options: help.options,
      commandOption,
      message: help.message,
    },
    tab: tabPreview(active, filtered, grammar),
    shorthandExamples: shorthandExamples(active, filtered),
  };
};

export const validateCustomCommand = (
  value: unknown,
  options: CustomCommandValidationOptions = {},
): CustomCommandValidation => {
  const errors: CustomCommandIssue[] = [];
  const warnings: CustomCommandIssue[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [issue("INVALID_RECORD", "command", "Custom command must be a JSON-like object.")],
      warnings,
    };
  }

  if (ownData(value, "schemaVersion") !== customCommandSchemaVersion) {
    errors.push(issue("SCHEMA_VERSION", "schemaVersion", `Use custom command schema version ${customCommandSchemaVersion}; migrate legacy commands before editing them.`));
  }
  if (ownData(value, "legacy") === true) {
    errors.push(issue("LEGACY_INCOMPLETE", "legacy", "This retained legacy command must be completed before it can become active."));
  }

  const id = textField(value, "id", "Command ID", customCommandLimits.id, errors);
  if (id && !/^custom\.[a-zA-Z0-9_-]{8,90}$/u.test(id)) {
    errors.push(issue("INVALID_ID", "id", "Command ID must start with “custom.” and contain 8–90 letters, numbers, underscores or hyphens after the prefix."));
  }

  const profileValue = ownData(value, "deviceProfile");
  const deviceProfile = typeof profileValue === "string" ? profileValue : "";
  const profileId = deviceProfile in deviceProfiles ? deviceProfile as DeviceProfileId : null;
  if (!profileId) {
    errors.push(issue("INVALID_PROFILE", "deviceProfile", "Select the IOS XE training router or Catalyst Layer 2 training switch profile."));
  }

  const modeValue = ownData(value, "mode");
  const modeText = typeof modeValue === "string" ? modeValue : "";
  const mode = cliModes.includes(modeText as CliMode) ? modeText as CliMode : null;
  if (!mode) errors.push(issue("INVALID_CONTEXT", "mode", "Select a supported CLI context for this learning command."));

  const kindValue = ownData(value, "kind");
  const kindText = typeof kindValue === "string" ? kindValue : "";
  const kind = commandKinds.includes(kindText as CommandKind) ? kindText as CommandKind : null;
  if (!kind) errors.push(issue("INVALID_KIND", "kind", "Command type must be navigation, verification or configuration."));

  const difficultyValue = ownData(value, "difficulty");
  const difficulty = difficultyValue === 1 || difficultyValue === 2 || difficultyValue === 3
    ? difficultyValue
    : null;
  if (!difficulty) errors.push(issue("INVALID_DIFFICULTY", "difficulty", "Difficulty must be 1, 2 or 3."));

  const canonicalRaw = asString(ownData(value, "canonical"));
  const canonical = grammarErrors(canonicalRaw, errors);
  const objective = textField(value, "objective", "Outcome-based task", customCommandLimits.objective, errors, { multiline: true });
  const explanation = textField(value, "explanation", "Explanation", customCommandLimits.explanation, errors, { multiline: true });
  const topic = textField(value, "topic", "Topic", customCommandLimits.topic, errors);

  const semanticsValue = ownData(value, "semantics");
  const semanticsRecord = isRecord(semanticsValue) ? semanticsValue : null;
  if (!semanticsRecord) errors.push(issue("INVALID_RECORD", "semantics", "Advanced command semantics are required."));
  const semanticSource: Record<string, unknown> = semanticsRecord ?? {};
  const helpDescription = textField(
    semanticSource,
    "helpDescription",
    "Help description",
    customCommandLimits.helpDescription,
    errors,
    { multiline: true },
  );
  const effect = parseEffect(semanticSource, errors);
  const why = textField(semanticSource, "why", "Why it matters", customCommandLimits.why, errors, { multiline: true });
  const progressiveHints = listField(
    semanticSource,
    "progressiveHints",
    "Progressive hints",
    customCommandLimits.progressiveHint,
    customCommandLimits.progressiveHints,
    errors,
    1,
  );
  const revealExplanation = textField(
    semanticSource,
    "revealExplanation",
    "Reveal explanation",
    customCommandLimits.revealExplanation,
    errors,
    { multiline: true },
  );
  const verification = optionalTextField(
    semanticSource,
    "verification",
    "Verification metadata",
    customCommandLimits.verification,
    errors,
  );
  const undo = optionalTextField(semanticSource, "undo", "Undo metadata", customCommandLimits.undo, errors);
  const tags = listField(semanticSource, "tags", "Tags", customCommandLimits.tag, customCommandLimits.tags, errors);
  const prerequisites = listField(
    semanticSource,
    "prerequisites",
    "Prerequisites",
    customCommandLimits.prerequisite,
    customCommandLimits.prerequisites,
    errors,
  );

  if (effect?.type === "read-only" && kind && kind !== "verification") {
    errors.push(issue("KIND_EFFECT_MISMATCH", "kind", "An explicitly read-only result must use the verification command type."));
  }
  if (effect?.type === "state-change" && kind === "verification") {
    errors.push(issue("KIND_EFFECT_MISMATCH", "kind", "A state-changing command must use configuration or navigation type."));
  }
  if (effect?.type === "state-change" && !verification) {
    errors.push(issue("REQUIRED", "semantics.verification", "State-changing commands require verification metadata."));
  }
  if (effect?.type === "state-change" && !undo) {
    warnings.push(issue(
      "UNDO_RECOMMENDED",
      "semantics.undo",
      "Add undo metadata when the state change is reversible; otherwise explain the recovery path in the reveal text.",
      "warning",
    ));
  }

  if (profileId && mode) {
    const contextMessage = profileContextMessage(profileId, mode);
    if (contextMessage) errors.push(issue("PROFILE_CONTEXT_MISMATCH", "mode", contextMessage));
  }
  if (profileId && canonical) {
    const commandMessage = profileCommandMessage(profileId, canonical);
    if (commandMessage) errors.push(issue("PROFILE_COMMAND_MISMATCH", "canonical", commandMessage));
  }

  const draft: CustomCommandDraft = {
    schemaVersion: customCommandSchemaVersion,
    status: "draft",
    legacy: false,
    deviceProfile,
    id,
    mode: modeText,
    canonical,
    objective,
    explanation,
    topic,
    difficulty: typeof difficultyValue === "number" ? difficultyValue : 0,
    kind: kindText,
    custom: true,
    semantics: {
      helpDescription,
      effect,
      why,
      progressiveHints,
      revealExplanation,
      ...(verification ? { verification } : {}),
      ...(undo ? { undo } : {}),
      tags,
      prerequisites,
    },
  };

  if (errors.length || !profileId || !mode || !kind || !difficulty || !effect) {
    return { ok: false, draft, errors, warnings };
  }

  const semantics: CustomCommandSemantics = {
    helpDescription,
    effect,
    why,
    progressiveHints,
    revealExplanation,
    ...(verification ? { verification } : {}),
    ...(undo ? { undo } : {}),
    tags,
    prerequisites,
  };
  const active = activeFromDraft(draft, profileId, mode, kind, difficulty, semantics);
  const parserErrors = parserAndCollisionIssues(active, options.catalogue ?? []);
  if (parserErrors.length) return { ok: false, draft, errors: parserErrors, warnings };
  return {
    ok: true,
    active,
    command: toCommand(active),
    preview: previewCustomCommand(active, options.catalogue ?? []),
    warnings,
  };
};

const legacyString = (record: Record<string, unknown>, field: string, fallback = ""): string => {
  const value = ownData(record, field);
  return typeof value === "string" ? value : fallback;
};

const auditLegacyText = (
  value: string,
  field: string,
  maximum: number,
  issues: CustomCommandIssue[],
): void => {
  if (value.length > maximum) {
    issues.push(issue("TOO_LONG", field, `Legacy ${field} exceeds the current ${maximum}-character limit.`));
  }
  if (forbiddenProse.test(value)) {
    issues.push(issue("UNSAFE_TEXT", field, `Legacy ${field} contains control or bidirectional formatting characters and cannot be activated.`));
  }
};

export const migrateLegacyCustomCommand = (value: unknown, index = 0): LegacyCustomCommand => {
  const record = isRecord(value) ? value : {};
  const issues: CustomCommandIssue[] = [issue(
    "LEGACY_INCOMPLETE",
    "command",
    "Legacy command retained. Select a device profile and complete help, effect, why, hints, reveal and verification or undo metadata before activation.",
  )];
  const originalId = legacyString(record, "id");
  const id = /^custom\.[a-zA-Z0-9_-]{8,90}$/u.test(originalId)
    ? originalId
    : `custom.legacy${String(index).padStart(8, "0")}`;
  if (id !== originalId) {
    issues.push(issue("INVALID_ID", "id", "The original legacy ID is retained in legacySource; a safe review ID was assigned to this incomplete record."));
  }
  const canonical = legacyString(record, "canonical");
  const objective = legacyString(record, "objective");
  const explanation = legacyString(record, "explanation");
  const topic = legacyString(record, "topic", "Custom");
  auditLegacyText(canonical, "canonical", customCommandLimits.canonical, issues);
  auditLegacyText(objective, "objective", customCommandLimits.objective, issues);
  auditLegacyText(explanation, "explanation", customCommandLimits.explanation, issues);
  auditLegacyText(topic, "topic", customCommandLimits.topic, issues);
  const difficultyValue = ownData(record, "difficulty");
  return {
    schemaVersion: customCommandSchemaVersion,
    status: "incomplete",
    legacy: true,
    deviceProfile: null,
    id,
    mode: legacyString(record, "mode", "privileged"),
    canonical,
    objective,
    explanation,
    topic,
    difficulty: typeof difficultyValue === "number" ? difficultyValue : 1,
    kind: legacyString(record, "kind", "verification"),
    custom: true,
    semantics: {
      helpDescription: "",
      effect: null,
      why: "",
      progressiveHints: [],
      revealExplanation: "",
      tags: [],
      prerequisites: [],
    },
    issues,
    legacySource: value,
  };
};

const uniqueIssues = (values: readonly CustomCommandIssue[]): CustomCommandIssue[] => {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = `${entry.code}\u001f${entry.field}\u001f${entry.message}\u001f${entry.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const incompleteVersionTwoRecord = (
  source: Record<string, unknown>,
  validation: CustomCommandValidation,
  message: string,
  additionalIssues: readonly CustomCommandIssue[] = [],
): IncompleteCustomCommand => {
  const legacy = ownData(source, "legacy") === true;
  const legacySource = ownData(source, "legacySource");
  const reviewIssue = issue("INCOMPLETE_REVIEW", "command", message);
  if (validation.ok) {
    const active = validation.active;
    return {
      schemaVersion: customCommandSchemaVersion,
      status: "incomplete",
      legacy,
      deviceProfile: active.deviceProfile,
      id: active.id,
      mode: active.mode,
      canonical: active.canonical,
      objective: active.objective,
      explanation: active.explanation,
      topic: active.topic,
      difficulty: active.difficulty,
      kind: active.kind,
      custom: true,
      semantics: active.semantics,
      issues: uniqueIssues([reviewIssue, ...additionalIssues, ...validation.warnings]),
      ...(legacySource !== missing ? { legacySource } : {}),
    };
  }

  const draft = validation.draft;
  const profile = draft && typeof draft.deviceProfile === "string" && draft.deviceProfile in deviceProfiles
    ? draft.deviceProfile as DeviceProfileId
    : null;
  return {
    schemaVersion: customCommandSchemaVersion,
    status: "incomplete",
    legacy,
    deviceProfile: profile,
    id: draft?.id ?? "",
    mode: typeof draft?.mode === "string" ? draft.mode : "",
    canonical: draft?.canonical ?? "",
    objective: draft?.objective ?? "",
    explanation: draft?.explanation ?? "",
    topic: draft?.topic ?? "",
    difficulty: draft?.difficulty ?? 0,
    kind: typeof draft?.kind === "string" ? draft.kind : "",
    custom: true,
    semantics: draft?.semantics ?? {
      helpDescription: "",
      effect: null,
      why: "",
      progressiveHints: [],
      revealExplanation: "",
      tags: [],
      prerequisites: [],
    },
    issues: uniqueIssues([reviewIssue, ...additionalIssues, ...validation.errors, ...validation.warnings]),
    ...(legacySource !== missing ? { legacySource } : {}),
  };
};

/**
 * Restore a mixed persisted list. Valid version-2 active records are
 * revalidated and remain active; version-2 incomplete records remain inactive;
 * only flat version-1 Command objects are migrated to legacy records.
 */
export const migrateLegacyCustomCommands = (
  value: unknown,
  options: CustomCommandValidationOptions = {},
): CustomCommandMigrationResult => {
  if (!Array.isArray(value)) {
    return {
      records: [],
      storeIssues: [issue("INVALID_RECORD", "commands", "Stored custom command data must be a list. No source data was changed.")],
    };
  }
  const storeIssues: CustomCommandIssue[] = [];
  if (value.length > 500) {
    storeIssues.push(issue(
      "INVALID_LIST",
      "commands",
      "More than 500 legacy commands were retained for review; reduce the list before saving the active store.",
    ));
  }
  const records: CustomCommandRecord[] = [];
  const activeCatalogue: RegistryCommand[] = [...(options.catalogue ?? [])];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const entry = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (!isRecord(entry) || ownData(entry, "schemaVersion") !== customCommandSchemaVersion) {
      records.push(migrateLegacyCustomCommand(entry, index));
      continue;
    }

    const status = ownData(entry, "status");
    const validation = validateCustomCommand(entry, { catalogue: activeCatalogue });
    if (status === "active" && validation.ok) {
      records.push(validation.active);
      // Active records are structural RegistryCommands and retain their
      // deviceProfile for profile-aware collision checks on following entries.
      activeCatalogue.push(validation.active);
      continue;
    }

    const statusIssue = status === "active" || status === "incomplete"
      ? []
      : [issue("INVALID_RECORD", "status", "Version-2 command status must be “active” or “incomplete”.")];
    const message = status === "active"
      ? "The saved active command could not be restored safely and was retained as incomplete. Review the reported fields before activating it again."
      : "This saved incomplete command remains inactive until an administrator completes and revalidates it.";
    records.push(incompleteVersionTwoRecord(entry, validation, message, statusIssue));
  }
  return {
    records,
    storeIssues,
  };
};

export interface ReconciledCustomCommandStore {
  records: CustomCommandRecord[];
  retainedLocal: boolean;
}

/**
 * An authenticated but empty Docker volume is a new destination, not evidence
 * that browser-only content should be deleted. Non-empty server content remains
 * authoritative; an empty server retains the local set until a deliberate save.
 */
export const reconcileCustomCommandStores = (
  local: readonly CustomCommandRecord[],
  server: readonly CustomCommandRecord[],
): ReconciledCustomCommandStore => server.length === 0 && local.length > 0
  ? { records: [...local], retainedLocal: true }
  : { records: [...server], retainedLocal: false };

/**
 * Commit an authoritative server snapshot before attempting the optional
 * browser mirror. A quota or privacy-policy failure must never roll the UI
 * back to stale records after Docker has already accepted the new version.
 */
export const commitAuthoritativeCustomCommandRecords = (
  records: readonly CustomCommandRecord[],
  commit: (records: CustomCommandRecord[]) => void,
  mirror: (records: readonly CustomCommandRecord[]) => void,
): boolean => {
  const snapshot = [...records];
  commit(snapshot);
  try {
    mirror(snapshot);
    return true;
  } catch {
    return false;
  }
};
