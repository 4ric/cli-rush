/**
 * Registry-backed guided builds for the declared router and Catalyst profiles.
 * Player input is inert text; it is parsed by the same deterministic registry
 * used by recall, contextual help and Tab completion.
 */

import { cliHelp, completeCliInput, type CliHelp, type CliCompletion } from "./cli-assistance.ts";
import {
  buildCommandRegistry,
  parseRegistryInput,
  redactRegistryInput,
  type CommandRegistry,
  type ParsedCommandEvent,
  type RegistryCommand,
  type RegistryParseResult,
} from "./command-registry.ts";
import { getDeviceProfile, type DeviceProfileId } from "./device-profiles.ts";
import {
  commands,
  executeCliCommand,
  initialDevice,
  modeNames,
  prompt,
  restoreDeviceCheckpoint,
  restoreDeviceState,
  runningConfig,
  type CliContext,
  type CliExecutionResult,
  type Command,
  type CommandKind,
  type DeviceState,
  type PendingInteraction,
} from "./engine.ts";
import {
  createLabContent,
  labContentDefinitions,
  type LabContentDefinition,
  type LabContentStep,
  type LabContext,
  type LabId,
  type LabPhase,
} from "./lab-content.ts";

export type DeviceBuildLabId = LabId;
export type DeviceBuildMode = LabContext;
export type DeviceBuildPhase = LabPhase;

export interface DeviceBuildStep {
  id: string;
  conceptId: string;
  phase: DeviceBuildPhase;
  mode: DeviceBuildMode;
  command: string;
  objective: string;
  why: string;
  detail: string;
  verify: string;
  rollback: string;
  hint1: string;
  hint2: string;
  interpretation: string;
  commonFailure: string;
  output?: readonly string[];
  nextMode?: DeviceBuildMode;
  nextHostname?: "R1" | "SW1";
  sensitiveArgumentNames?: readonly string[];
}

export interface DeviceBuildDefinition {
  id: DeviceBuildLabId;
  number: 2 | 3;
  shortTitle: string;
  title: string;
  summary: string;
  deviceType: "router" | "switch";
  deviceProfile: DeviceProfileId;
  steps: DeviceBuildStep[];
}

export interface DeviceBuildState {
  version: 3;
  seed: number;
  labId: DeviceBuildLabId;
  stepIndex: number;
  mode: DeviceBuildMode;
  hostname: string;
  completed: boolean;
  effects: string[];
  skippedSatisfiedStepIds: string[];
  runningConfiguration: string[];
  startupConfiguration: string[] | null;
  pendingConfirmation: DeviceBuildPendingConfirmation;
  /** Authoritative serialisable simulator state. The fields above are UI-compatible derived mirrors. */
  device: DeviceState;
}

/** UI mirror of the authoritative engine interaction stored on `device`. */
export type DeviceBuildPendingConfirmation =
  | "save-startup"
  | "reload"
  | "erase-startup"
  | "default-interface"
  | null;

export type DeviceBuildFeedbackCategory =
  | "objective-complete"
  | "valid-unrelated"
  | "awaiting-confirmation"
  | "wrong-context"
  | "incomplete"
  | "ambiguous"
  | "invalid"
  | "invalid-value"
  | "complete";

export interface DeviceBuildResult {
  accepted: boolean;
  valid: boolean;
  state: DeviceBuildState;
  output: string[];
  explanation: string;
  useCase: string;
  verification: string;
  rollback: string;
  interpretation?: string;
  commonFailure?: string;
  displayInput?: string;
  category: DeviceBuildFeedbackCategory;
  awaitingConfirmation?: boolean;
  skippedSatisfiedStepIds?: string[];
  errorCode?:
    | "EMPTY"
    | "TOO_LONG"
    | "WRONG_MODE"
    | "WRONG_COMMAND"
    | "INCOMPLETE"
    | "AMBIGUOUS"
    | "INVALID_VALUE"
    | "VALID_UNRELATED"
    | "COMPLETE";
}

const asStep = (item: LabContentStep): DeviceBuildStep => ({
  id: item.id,
  conceptId: item.conceptId,
  phase: item.phase,
  mode: item.context,
  command: item.command,
  objective: item.task,
  why: item.why,
  detail: item.effect,
  verify: item.verify,
  rollback: item.recovery,
  hint1: item.hint1,
  hint2: item.hint2,
  interpretation: item.interpretation,
  commonFailure: item.commonFailure,
  ...(item.output ? { output: item.output } : {}),
  ...(item.nextContext ? { nextMode: item.nextContext } : {}),
  ...(item.nextHostname ? { nextHostname: item.nextHostname } : {}),
  ...(item.sensitiveArgumentNames ? { sensitiveArgumentNames: item.sensitiveArgumentNames } : {}),
});

const definitionFrom = (content: LabContentDefinition): DeviceBuildDefinition => ({
  id: content.id,
  number: content.number,
  shortTitle: content.id === "router-foundation" ? "Router foundation" : "Switch foundation",
  title: content.title,
  summary: content.summary,
  deviceType: content.deviceProfile === "router-ios-xe" ? "router" : "switch",
  deviceProfile: content.deviceProfile,
  steps: content.steps.map(asStep),
});

const staticDefinitions = new Map(labContentDefinitions.map((content) => [content.id, definitionFrom(content)]));

export const deviceBuildLabs = [...staticDefinitions.values()];
export const getDeviceBuildDefinition = (id: DeviceBuildLabId): DeviceBuildDefinition => staticDefinitions.get(id)!;

const definitionForState = (state: Pick<DeviceBuildState, "labId" | "seed">): DeviceBuildDefinition =>
  definitionFrom(createLabContent(state.labId, state.seed));

const sensitivePositions = (canonical: string): number[] => {
  const tokens = canonical.trim().split(/\s+/u);
  const positions: number[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    if (["secret", "password", "community", "key"].includes(tokens[index - 1].toLocaleLowerCase("en-GB"))) positions.push(index);
  }
  return positions;
};

export interface DeviceBuildCommand extends RegistryCommand {
  mode: CliContext;
  kind: CommandKind;
}

const registryCommandFrom = (labId: DeviceBuildLabId, item: DeviceBuildStep): DeviceBuildCommand => ({
  id: `lab.${labId}.${item.id}`,
  mode: item.mode,
  canonical: item.command,
  objective: item.objective,
  explanation: item.detail,
  topic: "Guided lab",
  difficulty: 1,
  kind: item.nextMode ? "navigation" : /^(?:show|ping|ssh\s+-l)/iu.test(item.command) ? "verification" : "configuration",
  caseSensitiveTokens: sensitivePositions(item.command),
});

export const deviceBuildCatalogue = (id: DeviceBuildLabId, seed = 1): DeviceBuildCommand[] =>
  definitionFrom(createLabContent(id, seed)).steps.map((item) => registryCommandFrom(id, item));

const fullCatalogueCache = new Map<string, RegistryCommand[]>();
const fullCatalogue = (id: DeviceBuildLabId, seed: number): RegistryCommand[] => {
  const cacheKey = `${id}:${seed}`;
  const cached = fullCatalogueCache.get(cacheKey);
  if (cached) return cached;
  const byShape = new Map<string, RegistryCommand>();
  for (const command of [...commands, ...deviceBuildCatalogue(id, seed)]) {
    const key = `${command.mode}:${command.canonical.toLocaleLowerCase("en-GB")}`;
    if (!byShape.has(key)) byShape.set(key, command);
  }
  const catalogue = [...byShape.values()];
  fullCatalogueCache.set(cacheKey, catalogue);
  return catalogue;
};

/** Read-only view used by UI teaching aids; parsing still happens here. */
export const getDeviceBuildCatalogue = (state: Pick<DeviceBuildState, "labId" | "seed">): readonly RegistryCommand[] =>
  fullCatalogue(state.labId, state.seed);

const registryCache = new Map<string, CommandRegistry>();
const registryFor = (id: DeviceBuildLabId, seed: number): CommandRegistry => {
  const key = `${id}:${seed}`;
  const cached = registryCache.get(key);
  if (cached) return cached;
  const definition = definitionFrom(createLabContent(id, seed));
  const registry = buildCommandRegistry(
    fullCatalogue(id, seed),
    getDeviceProfile(definition.deviceProfile),
    { includeSupplemental: true },
  );
  registryCache.set(key, registry);
  return registry;
};

const cloneDevice = (device: DeviceState): DeviceState =>
  JSON.parse(JSON.stringify(device)) as DeviceState;

const clone = (state: DeviceBuildState): DeviceBuildState => ({
  ...state,
  effects: [...state.effects],
  skippedSatisfiedStepIds: [...state.skippedSatisfiedStepIds],
  runningConfiguration: [...state.runningConfiguration],
  startupConfiguration: state.startupConfiguration ? [...state.startupConfiguration] : null,
  device: cloneDevice(state.device),
});

const stableSeed = (seed: number): number =>
  (Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1) || 1;

export const createDeviceBuildState = (id: DeviceBuildLabId, seed = 1): DeviceBuildState => {
  const safeSeed = stableSeed(seed);
  const content = createLabContent(id, safeSeed);
  const device = initialDevice(content.deviceProfile);
  device.hostname = content.initialHostname;

  // The router exercise declares an already-cabled WAN /30. Seeding it here
  // makes connected/default-route evidence and remote probes consequences of
  // device state rather than authored output strings.
  if (id === "router-foundation") {
    const wan = device.interfaces["GigabitEthernet0/0/0"];
    wan.ipv4 = "192.0.2.1";
    wan.mask = "255.255.255.252";
    wan.adminUp = true;
    wan.carrierUp = true;
    wan.touched = true;
  }

  return syncDerivedState({
    version: 3,
    seed: safeSeed,
    labId: id,
    stepIndex: 0,
    mode: "user",
    hostname: content.initialHostname,
    completed: false,
    effects: [],
    skippedSatisfiedStepIds: [],
    runningConfiguration: [],
    startupConfiguration: null,
    pendingConfirmation: null,
    device,
  });
};

const syncDerivedState = (state: DeviceBuildState): DeviceBuildState => {
  const legacyRedaction = (line: string): string => line.replace(/\[configured\]/gu, "[redacted]");
  state.mode = state.device.context as DeviceBuildMode;
  state.hostname = state.device.hostname;
  state.runningConfiguration = runningConfig(state.device).split("\n").map(legacyRedaction);
  state.startupConfiguration = state.device.startup?.split("\n").map(legacyRedaction) ?? null;
  const pending = state.device.pendingInteraction;
  state.pendingConfirmation = pending?.kind === "save" ? "save-startup" : pending?.kind ?? null;
  return state;
};

const executeShared = (state: DeviceBuildState, input: string): CliExecutionResult =>
  executeCliCommand(
    state.device,
    input,
    fullCatalogue(state.labId, state.seed) as unknown as readonly Command[],
  );

const applyCompletedPrefix = (
  state: DeviceBuildState,
  steps: readonly DeviceBuildStep[],
  count: number,
): DeviceBuildState => {
  for (const item of steps.slice(0, count)) {
    const execution = executeShared(state, item.command);
    if (!execution.accepted) break;
    state.device = execution.state;
    if (state.device.pendingInteraction?.kind === "save") {
      const confirmation = executeShared(state, "");
      if (!confirmation.accepted) break;
      state.device = confirmation.state;
    }
    if (!state.effects.includes(item.id)) state.effects.push(item.id);
    state.stepIndex += 1;
  }
  state.completed = state.stepIndex >= steps.length;
  return syncDerivedState(state);
};

const oldTotals: Readonly<Record<DeviceBuildLabId, number>> = {
  "router-foundation": 40,
  "switch-foundation": 53,
};

const oldToNew: Readonly<Record<string, string>> = {
  configure: "configure-terminal",
  "local-user": "local-admin",
  "radius-context": "radius-server",
  "exit-radius": "leave-radius",
  domain: "domain-name",
  rsa: "rsa-key",
  vty: "vty-lines",
  "vty-auth": "vty-login",
  "vty-transport": "vty-ssh-only",
  "exit-vty": "leave-vty",
  "dhcp-excluded": "dhcp-exclusion",
  "dhcp-router": "dhcp-gateway",
  "exit-dhcp": "leave-dhcp",
  "lan-up": "lan-enable",
  "exit-lan": "leave-lan",
  "vlan-users": "vlan10",
  "name-users": "vlan10-name",
  "exit-users": "leave-vlan10",
  "vlan-management": "vlan99",
  "name-management": "vlan99-name",
  "exit-management": "leave-vlan99",
  "management-ip": "management-address",
  "management-up": "management-enable",
  "exit-svi": "leave-management-svi",
  "default-gateway": "management-gateway",
};

const oldStepIds: Readonly<Record<DeviceBuildLabId, readonly string[]>> = {
  "router-foundation": ["enable", "configure", "hostname", "enable-secret", "password-encryption", "local-user", "radius-context", "radius-address", "radius-key", "exit-radius", "aaa-new-model", "aaa-login", "domain", "rsa", "ssh-version", "vty", "vty-auth", "vty-transport", "exit-vty", "dns", "dhcp-excluded", "dhcp-pool", "dhcp-network", "dhcp-router", "dhcp-dns", "exit-dhcp", "lan-interface", "lan-description", "lan-address", "lan-up", "exit-lan", "wan-interface", "wan-description", "wan-address", "wan-up", "exit-wan", "end", "verify-ip", "verify-ssh", "save"],
  "switch-foundation": ["enable", "configure", "hostname", "enable-secret", "password-encryption", "local-user", "radius-context", "radius-address", "radius-key", "exit-radius", "aaa-new-model", "aaa-login", "domain", "rsa", "ssh-version", "vty", "vty-auth", "vty-transport", "exit-vty", "dns", "vlan-users", "name-users", "exit-users", "vlan-management", "name-management", "exit-management", "fast-access", "access-mode", "access-vlan", "portfast", "bpduguard", "access-up", "exit-access", "trunk-interface", "trunk-mode", "trunk-allowed", "trunk-up", "exit-trunk", "fibre-interface", "fibre-description", "fibre-trunk", "fibre-allowed", "fibre-up", "exit-fibre", "management-svi", "management-ip", "management-up", "exit-svi", "default-gateway", "end", "verify-ip", "verify-ssh", "save"],
};

const migrateVersionOne = (saved: Record<string, unknown>): DeviceBuildState | null => {
  const id = saved.labId;
  if (id !== "router-foundation" && id !== "switch-foundation") return null;
  if (!Number.isInteger(saved.stepIndex) || (saved.stepIndex as number) < 0 || (saved.stepIndex as number) > oldTotals[id]) return null;
  const completedOldIds = new Set(oldStepIds[id].slice(0, saved.stepIndex as number).map((oldId) => oldToNew[oldId] ?? oldId));
  const state = createDeviceBuildState(id);
  const definition = definitionForState(state);
  let prefix = 0;
  while (prefix < definition.steps.length && completedOldIds.has(definition.steps[prefix].id)) prefix += 1;
  return applyCompletedPrefix(state, definition.steps, prefix);
};

const safeStringArray = (value: unknown, limit: number): value is string[] =>
  Array.isArray(value)
  && value.length <= limit
  && value.every((item) => typeof item === "string" && item.length <= 512);

const containsUnredactedSecret = (lines: readonly string[]): boolean =>
  lines.some((line) =>
    /\b(?:secret|password|community)\s+(?!\[(?:redacted|configured)\])\S+/iu.test(line)
    || /(?:^|\s)key\s+(?!(?:generate|zeroize)\b|\[(?:redacted|configured)\])\S+/iu.test(line));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validRecordSize = (value: unknown, limit: number): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).length <= limit;

const serialisedWithin = (value: unknown, limit: number): string | null => {
  try {
    const serialised = JSON.stringify(value);
    return serialised.length <= limit ? serialised : null;
  } catch {
    return null;
  }
};

const validPendingInteraction = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "save") return value.destination === "startup-config";
  if (value.kind === "default-interface") {
    return typeof value.interfaceName === "string" && value.interfaceName.length >= 1 && value.interfaceName.length <= 64;
  }
  return value.kind === "reload" || value.kind === "erase-startup";
};

const pendingConfirmationFor = (pending: PendingInteraction | null): DeviceBuildPendingConfirmation =>
  pending?.kind === "save" ? "save-startup" : pending?.kind ?? null;

const nullableString = (value: unknown, limit = 256): boolean =>
  value === null || (typeof value === "string" && value.length <= limit);

const nullableFiniteNumber = (value: unknown): boolean =>
  value === null || (typeof value === "number" && Number.isFinite(value));

const validInterfaceStateRecord = (value: Record<string, unknown>): boolean =>
  Object.entries(value).every(([name, candidate]) => {
    if (!isRecord(candidate) || candidate.name !== name || name.length > 64) return false;
    return typeof candidate.description === "string" && candidate.description.length <= 256
      && nullableString(candidate.ipv4, 45) && nullableString(candidate.mask, 45)
      && typeof candidate.adminUp === "boolean" && typeof candidate.carrierUp === "boolean"
      && nullableFiniteNumber(candidate.encapsulationDot1q)
      && (candidate.switchportMode === null || candidate.switchportMode === "access" || candidate.switchportMode === "trunk")
      && nullableFiniteNumber(candidate.accessVlan) && nullableFiniteNumber(candidate.voiceVlan)
      && nullableFiniteNumber(candidate.trunkNativeVlan)
      && Array.isArray(candidate.trunkAllowedVlans) && candidate.trunkAllowedVlans.length <= 4094
      && candidate.trunkAllowedVlans.every((id) => Number.isInteger(id) && id >= 1 && id <= 4094)
      && typeof candidate.portFast === "boolean" && typeof candidate.bpduGuard === "boolean"
      && typeof candidate.portSecurity === "boolean" && nullableFiniteNumber(candidate.portSecurityMaximum)
      && nullableString(candidate.portSecurityViolation, 32)
      && nullableFiniteNumber(candidate.channelGroup) && nullableString(candidate.channelMode, 32)
      && nullableString(candidate.helperAddress, 45) && nullableString(candidate.natRole, 16)
      && nullableFiniteNumber(candidate.bandwidthKbps) && nullableFiniteNumber(candidate.loadIntervalSeconds)
      && typeof candidate.negotiationAuto === "boolean" && nullableString(candidate.stormControlBroadcastLevel, 32)
      && typeof candidate.udldPort === "boolean" && nullableFiniteNumber(candidate.dhcpSnoopingRate)
      && typeof candidate.touched === "boolean";
  });

const validStringArrayMap = (value: Record<string, unknown>, itemLimit = 256): boolean =>
  Object.values(value).every((items) => safeStringArray(items, itemLimit));

const validDeviceObjects = (value: Record<string, unknown>): boolean => {
  const interfaces = value.interfaces as Record<string, unknown>;
  const vlans = value.vlans as Record<string, unknown>;
  const users = value.users as Record<string, unknown>;
  const radiusServers = value.radiusServers as Record<string, unknown>;
  const dhcpPools = value.dhcpPools as Record<string, unknown>;
  return validInterfaceStateRecord(interfaces)
    && typeof interfaces[value.selectedInterface as string] === "object"
    && Object.values(vlans).every((vlan) => isRecord(vlan)
      && Number.isInteger(vlan.id) && typeof vlan.name === "string" && vlan.name.length <= 64
      && typeof vlan.active === "boolean")
    && Object.values(users).every((user) => isRecord(user)
      && Number.isInteger(user.privilege) && typeof user.secretConfigured === "boolean")
    && Object.values(radiusServers).every((server) => isRecord(server)
      && typeof server.name === "string" && nullableString(server.address, 45)
      && Number.isInteger(server.authenticationPort) && Number.isInteger(server.accountingPort)
      && typeof server.keyConfigured === "boolean" && typeof server.administrativelyDisabled === "boolean")
    && Object.values(dhcpPools).every((pool) => isRecord(pool)
      && typeof pool.name === "string" && nullableString(pool.network, 45) && nullableString(pool.mask, 45)
      && nullableString(pool.defaultRouter, 45) && nullableString(pool.dnsServer, 45)
      && nullableString(pool.domainName, 255))
    && validStringArrayMap(value.aaaGroups as Record<string, unknown>, 32)
    && validStringArrayMap(value.lineSettings as Record<string, unknown>)
    && validStringArrayMap(value.aclEntries as Record<string, unknown>)
    && validStringArrayMap(value.ospfProcesses as Record<string, unknown>);
};

const validDeviceState = (
  value: unknown,
  definition: DeviceBuildDefinition,
): value is DeviceState => {
  if (!restoreDeviceState(value, definition.deviceProfile)) return false;
  if (!isRecord(value) || value.profileId !== definition.deviceProfile) return false;
  if (typeof value.hostname !== "string" || !/^[A-Za-z0-9-]{1,63}$/u.test(value.hostname)) return false;
  if (typeof value.context !== "string" || !Object.hasOwn(modeNames, value.context)) return false;
  if (typeof value.selectedInterface !== "string" || value.selectedInterface.length > 64) return false;
  if (!safeStringArray(value.selectedInterfaces, 64) || !safeStringArray(value.routes, 256)
    || !safeStringArray(value.nameServers, 16) || !safeStringArray(value.aaaLoginMethods, 32)
    || !safeStringArray(value.aaaAuthorisationMethods, 32)
    || !safeStringArray(value.appliedConfiguration, 512)) return false;
  if (!Array.isArray(value.staticRoutes) || value.staticRoutes.length > 128
    || !Array.isArray(value.dhcpExcluded) || value.dhcpExcluded.length > 128) return false;
  if (!validRecordSize(value.interfaces, 128) || !validRecordSize(value.vlans, 4094)
    || !validRecordSize(value.users, 64) || !validRecordSize(value.radiusServers, 32)
    || !validRecordSize(value.aaaGroups, 32) || !validRecordSize(value.lineSettings, 64)
    || !validRecordSize(value.dhcpPools, 64) || !validRecordSize(value.aclEntries, 128)
    || !validRecordSize(value.ospfProcesses, 64)) return false;
  if (!validDeviceObjects(value)) return false;
  if (!value.staticRoutes.every((route) => isRecord(route)
    && typeof route.destination === "string" && typeof route.mask === "string"
    && typeof route.nextHop === "string" && nullableFiniteNumber(route.administrativeDistance))) return false;
  if (!value.dhcpExcluded.every((range) => isRecord(range)
    && typeof range.start === "string" && typeof range.end === "string")) return false;
  if (typeof value.enableSecretConfigured !== "boolean" || typeof value.passwordEncryption !== "boolean"
    || typeof value.aaaNewModel !== "boolean" || !nullableFiniteNumber(value.rsaKeyBits)
    || !nullableFiniteNumber(value.sshVersion) || !nullableString(value.defaultGateway, 45)
    || !nullableString(value.domainName, 255)) return false;
  if (!validPendingInteraction(value.pendingInteraction)) return false;
  if (value.startup !== null && (typeof value.startup !== "string" || value.startup.length > 131_072)) return false;
  if (value.startupSnapshot !== null && (typeof value.startupSnapshot !== "string" || value.startupSnapshot.length > 262_144)) return false;
  if (value.recoveryCheckpoint !== null && (typeof value.recoveryCheckpoint !== "string" || value.recoveryCheckpoint.length > 262_144)) return false;

  const serialised = serialisedWithin(value, 524_288);
  if (!serialised) return false;
  const sensitiveValues = definition.steps.filter((step) => step.sensitiveArgumentNames?.length).flatMap((step) => {
    const tokens = step.command.trim().split(/\s+/u);
    return sensitivePositions(step.command).map((index) => tokens[index]).filter(Boolean);
  });
  if (sensitiveValues.some((secret) => serialised.includes(secret))) return false;
  return !containsUnredactedSecret([
    ...(value.appliedConfiguration as string[]),
    ...(typeof value.startup === "string" ? value.startup.split("\n") : []),
  ]);
};

interface LegacyDeviceBuildStateV2 {
  version: 2;
  seed: number;
  labId: DeviceBuildLabId;
  stepIndex: number;
  mode: DeviceBuildMode;
  hostname: string;
  completed: boolean;
  effects: string[];
  skippedSatisfiedStepIds: string[];
  runningConfiguration: string[];
  startupConfiguration: string[] | null;
  pendingConfirmation: "save-startup" | null;
}

const migrateVersionTwo = (saved: LegacyDeviceBuildStateV2): DeviceBuildState | null => {
  const baseline = createDeviceBuildState(saved.labId, saved.seed);
  const definition = definitionForState(baseline);
  if (!Number.isInteger(saved.stepIndex) || saved.stepIndex < 0 || saved.stepIndex > definition.steps.length) return null;
  if (typeof saved.mode !== "string" || !Object.hasOwn(modeNames, saved.mode)) return null;
  if (typeof saved.hostname !== "string" || saved.hostname.length < 1 || saved.hostname.length > 63) return null;
  if (typeof saved.completed !== "boolean") return null;
  if (!safeStringArray(saved.effects, definition.steps.length)
    || !safeStringArray(saved.skippedSatisfiedStepIds, definition.steps.length)
    || !safeStringArray(saved.runningConfiguration, 256)
    || (saved.startupConfiguration !== null && !safeStringArray(saved.startupConfiguration, 256))
    || containsUnredactedSecret(saved.runningConfiguration)
    || (saved.startupConfiguration && containsUnredactedSecret(saved.startupConfiguration))) return null;
  if (saved.pendingConfirmation !== null && saved.pendingConfirmation !== "save-startup") return null;
  const known = new Set(definition.steps.map((item) => item.id));
  if (saved.effects.some((id) => !known.has(id)) || saved.skippedSatisfiedStepIds.some((id) => !known.has(id))) return null;

  const completedIds = new Set(saved.effects);
  let prefix = 0;
  while (prefix < definition.steps.length && completedIds.has(definition.steps[prefix].id)) prefix += 1;
  const migrated = applyCompletedPrefix(baseline, definition.steps, prefix);
  if (saved.pendingConfirmation === "save-startup" && definition.steps[migrated.stepIndex]?.command === "copy running-config startup-config") {
    const pending = executeShared(migrated, definition.steps[migrated.stepIndex].command);
    if (pending.accepted) migrated.device = pending.state;
  }
  return syncDerivedState(migrated);
};

export const restoreDeviceBuildState = (value: unknown): DeviceBuildState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version === 1) return migrateVersionOne(record);
  if (record.version === 2) {
    if (record.labId !== "router-foundation" && record.labId !== "switch-foundation") return null;
    return migrateVersionTwo(record as unknown as LegacyDeviceBuildStateV2);
  }
  const saved = record as Partial<DeviceBuildState> & Record<string, unknown>;
  if (saved.version !== 3 || (saved.labId !== "router-foundation" && saved.labId !== "switch-foundation")) return null;
  if (typeof saved.seed !== "number") return null;
  const baseline = createDeviceBuildState(saved.labId, saved.seed);
  const definition = definitionForState(baseline);
  if (!Number.isInteger(saved.stepIndex) || (saved.stepIndex as number) < 0 || (saved.stepIndex as number) > definition.steps.length) return null;
  if (typeof saved.mode !== "string" || !Object.hasOwn(modeNames, saved.mode)) return null;
  if (typeof saved.hostname !== "string" || saved.hostname.length < 1 || saved.hostname.length > 63) return null;
  if (typeof saved.completed !== "boolean" || saved.completed !== ((saved.stepIndex as number) >= definition.steps.length)) return null;
  if (!safeStringArray(saved.effects, definition.steps.length)
    || !safeStringArray(saved.skippedSatisfiedStepIds, definition.steps.length)
    || !safeStringArray(saved.runningConfiguration, 256)
    || (saved.startupConfiguration !== null && !safeStringArray(saved.startupConfiguration, 256))
    || containsUnredactedSecret(saved.runningConfiguration)
    || (saved.startupConfiguration && containsUnredactedSecret(saved.startupConfiguration))) return null;
  if (![null, "save-startup", "reload", "erase-startup", "default-interface"].includes(
    saved.pendingConfirmation as DeviceBuildPendingConfirmation,
  )) return null;
  if (!validDeviceState(saved.device, definition)) return null;
  const restoredDevice = restoreDeviceState(saved.device, definition.deviceProfile);
  if (!restoredDevice) return null;
  const known = new Set(definition.steps.map((item) => item.id));
  if (saved.effects.some((id) => !known.has(id)) || saved.skippedSatisfiedStepIds.some((id) => !known.has(id))) return null;
  const device = cloneDevice(restoredDevice);
  // Keep the historical keyboard-navigation mirror compatible, but never use
  // it to erase an authoritative interaction. Pending state must round-trip
  // exactly so reload/erase/default prompts cannot disappear on page reload.
  device.context = saved.mode as CliContext;
  if (device.hostname !== saved.hostname) return null;
  if (saved.pendingConfirmation !== pendingConfirmationFor(device.pendingInteraction)) return null;
  if (device.pendingInteraction?.kind === "default-interface"
    && !Object.hasOwn(device.interfaces, device.pendingInteraction.interfaceName)) return null;
  return syncDerivedState({
    version: 3,
    seed: baseline.seed,
    labId: saved.labId,
    stepIndex: saved.stepIndex as number,
    mode: saved.mode as DeviceBuildMode,
    hostname: saved.hostname,
    completed: saved.completed,
    effects: [...saved.effects],
    skippedSatisfiedStepIds: [...saved.skippedSatisfiedStepIds],
    runningConfiguration: [...saved.runningConfiguration],
    startupConfiguration: saved.startupConfiguration ? [...saved.startupConfiguration] : null,
    pendingConfirmation: saved.pendingConfirmation,
    device,
  });
};

export const deviceBuildPrompt = (state: DeviceBuildState): string => prompt({
  ...state.device,
  hostname: state.hostname,
  context: state.mode,
});

export const getDeviceBuildStep = (state: DeviceBuildState): DeviceBuildStep | null =>
  definitionForState(state).steps[state.stepIndex] ?? null;

const eventArguments = (event: ParsedCommandEvent): Array<{ value: string; caseSensitive: boolean }> =>
  event.production.tokens.flatMap((token) => token.kind === "argument"
    ? [{ value: event.normalisedArguments[token.name] ?? "", caseSensitive: token.caseSensitive }]
    : []);

const sameEventMeaning = (actual: ParsedCommandEvent, expected: ParsedCommandEvent): boolean => {
  if (actual.production.signature !== expected.production.signature) return false;
  const actualArgs = eventArguments(actual);
  const expectedArgs = eventArguments(expected);
  if (actualArgs.length !== expectedArgs.length) return false;
  return expectedArgs.every((expectedArg, index) => expectedArg.caseSensitive
    ? actualArgs[index].value === expectedArg.value
    : actualArgs[index].value.toLocaleLowerCase("en-GB") === expectedArg.value.toLocaleLowerCase("en-GB"));
};

const saveAlternative = (event: ParsedCommandEvent, step: DeviceBuildStep): boolean =>
  /^copy running-config startup-config$/iu.test(step.command)
  && /^(?:write(?: memory)?|copy running-config startup-config)$/iu.test(event.canonicalInput);

const expectedEventCache = new WeakMap<CommandRegistry, Map<string, ParsedCommandEvent>>();

const expectedEvent = (
  registry: CommandRegistry,
  step: DeviceBuildStep,
): ParsedCommandEvent => {
  const cache = expectedEventCache.get(registry) ?? new Map<string, ParsedCommandEvent>();
  expectedEventCache.set(registry, cache);
  const cached = cache.get(step.id);
  if (cached) return cached;
  const parsed = parseRegistryInput(registry, step.command, step.mode);
  if (parsed.status !== "valid") throw new Error(`Lab command is not registered: ${step.id} (${parsed.status})`);
  cache.set(step.id, parsed.event);
  return parsed.event;
};

const eventMatchesStep = (
  registry: CommandRegistry,
  event: ParsedCommandEvent,
  step: DeviceBuildStep,
): boolean => saveAlternative(event, step) || sameEventMeaning(event, expectedEvent(registry, step));

const stepMatchingEvent = (
  definition: DeviceBuildDefinition,
  registry: CommandRegistry,
  event: ParsedCommandEvent,
): DeviceBuildStep | null => definition.steps.find((candidate) =>
  candidate.mode === event.context && eventMatchesStep(registry, event, candidate)) ?? null;

const interfaceReady = (device: DeviceState, name: string): boolean => {
  const item = device.interfaces[name];
  return Boolean(item?.adminUp && item.carrierUp);
};

const radiusAdministrativelyDisabled = (device: DeviceState): boolean =>
  Object.values(device.radiusServers).some((server) =>
    (server as typeof server & { administrativelyDisabled?: boolean }).administrativelyDisabled === true);

const radiusModelsAdministrativeState = (device: DeviceState): boolean =>
  Object.values(device.radiusServers).some((server) => Object.hasOwn(server, "administrativelyDisabled"));

const allInterfaces = (
  device: DeviceState,
  names: readonly string[],
  predicate: (item: DeviceState["interfaces"][string]) => boolean,
): boolean => names.every((name) => Boolean(device.interfaces[name]) && predicate(device.interfaces[name]));

/**
 * Syntax identifies the requested task; this guard proves that the shared
 * simulator actually produced the state/evidence the task claims to verify.
 */
const executionSatisfiesStep = (
  step: DeviceBuildStep,
  execution: CliExecutionResult,
): boolean => {
  if (!execution.accepted) return false;
  const device = execution.state;
  const output = execution.output.join("\n");
  const vlanNamed = (id: number, name: string): boolean =>
    device.vlans[id]?.active === true && device.vlans[id]?.name === name;
  const defaultRoute = device.staticRoutes.some((route) =>
    route.destination === "0.0.0.0" && route.mask === "0.0.0.0" && route.nextHop === "192.0.2.2");
  const usersPool = device.dhcpPools.USERS;

  switch (step.id) {
    case "verify-interfaces":
      return interfaceReady(device, "GigabitEthernet0/0/0")
        && interfaceReady(device, "GigabitEthernet0/0/1")
        && device.interfaces["GigabitEthernet0/0/0"]?.ipv4 === "192.0.2.1"
        && device.interfaces["GigabitEthernet0/0/1"]?.ipv4 === "192.168.10.1";
    case "verify-routes":
      return defaultRoute && /0\.0\.0\.0\/0|candidate default/iu.test(output);
    case "verify-dhcp-pool":
      return usersPool?.network === "192.168.10.0"
        && usersPool.mask === "255.255.255.0"
        && usersPool.defaultRouter === "192.168.10.1"
        && usersPool.dnsServer === "192.0.2.53"
        && /Pool USERS/iu.test(output);
    case "verify-dhcp-binding":
      return Boolean(usersPool?.network && usersPool.mask)
        && /192\.168\.10\.21/iu.test(output)
        && !/No DHCP bindings/iu.test(output);
    case "verify-aaa-ready":
      return !radiusAdministrativelyDisabled(device)
        && Object.values(device.radiusServers).some((server) => Boolean(server.address && server.keyConfigured))
        && /State: UP/iu.test(output);
    case "verify-central-login":
      return !radiusAdministrativelyDisabled(device)
        && Object.values(device.radiusServers).some((server) => Boolean(server.address && server.keyConfigured))
        && /(?:RADIUS|central).*(?:accepted|success)/iu.test(output);
    case "simulate-radius-outage":
      return radiusAdministrativelyDisabled(device);
    case "verify-aaa":
      return (!radiusModelsAdministrativeState(device) || radiusAdministrativelyDisabled(device))
        && /(?:DEAD|unavailable|disabled|no response)/iu.test(output);
    case "verify-fallback":
      return (!radiusModelsAdministrativeState(device) || radiusAdministrativelyDisabled(device))
        && Boolean(device.users.localadmin)
        && device.aaaLoginMethods.some((method) => / group \S+ local$/iu.test(method))
        && /local fallback.*accepted|accepted.*local/iu.test(output);
    case "verify-ssh":
      return device.sshVersion === 2 && device.rsaKeyBits === 2048 && /SSH Enabled - version 2/iu.test(output);
    case "test-lan":
    case "test-remote":
    case "test-management-gateway":
      return /Success rate is 100 percent \(5\/5\)/iu.test(output);
    case "verify-vlans":
    case "verify-vlan-membership":
      return vlanNamed(10, "DATA") && vlanNamed(20, "VOICE") && vlanNamed(99, "MANAGEMENT")
        && /10\s+DATA/iu.test(output) && /20\s+VOICE/iu.test(output) && /99\s+MANAGEMENT/iu.test(output);
    case "verify-interface-status":
      return allInterfaces(device, ["FastEthernet1/0/1", "FastEthernet1/0/4", "FastEthernet1/0/5", "FastEthernet1/0/8"], (item) => item.adminUp)
        && allInterfaces(device, ["FastEthernet1/0/9", "FastEthernet1/0/24"], (item) => !item.adminUp)
        && /FastEthernet1\/0\/1\s+connected/iu.test(output)
        && /FastEthernet1\/0\/9\s+disabled/iu.test(output);
    case "verify-trunk": {
      const channel = device.interfaces["Port-channel1"];
      return channel?.adminUp === true && channel.switchportMode === "trunk"
        && [10, 20, 99].every((id) => channel.trunkAllowedVlans.includes(id))
        && /Port-channel1.*10,20,99/iu.test(output);
    }
    case "verify-spanning-tree":
      return [10, 20, 99].every((id) => Boolean(device.vlans[id]?.active))
        && /VLAN0010/iu.test(output) && /Port-channel1/iu.test(output);
    case "verify-port-security":
      return allInterfaces(
        device,
        Array.from({ length: 8 }, (_, index) => `FastEthernet1/0/${index + 1}`),
        (item) => item.portSecurity && item.portSecurityMaximum === 2 && item.portSecurityViolation === "restrict",
      ) && /Maximum 2 Violation restrict/iu.test(output);
    case "verify-etherchannel":
      return allInterfaces(device, ["TenGigabitEthernet1/1/1", "TenGigabitEthernet1/1/2"], (item) =>
        item.channelGroup === 1 && item.channelMode === "active")
        && /TenGigabitEthernet1\/1\/1/iu.test(output)
        && /TenGigabitEthernet1\/1\/2/iu.test(output);
    case "save":
    case "save-switch":
      return device.pendingInteraction === null && device.startup !== null;
    case "verify-startup":
    case "verify-switch-startup":
      return device.startup !== null && output === device.startup;
    default:
      return true;
  }
};

const advanceAfterCompletion = (
  state: DeviceBuildState,
  definition: DeviceBuildDefinition,
): string[] => {
  state.stepIndex += 1;
  const skipped: string[] = [];
  while (state.stepIndex < definition.steps.length) {
    const next = definition.steps[state.stepIndex];
    if (!state.effects.includes(next.id)) break;
    skipped.push(next.id);
    state.skippedSatisfiedStepIds.push(next.id);
    state.stepIndex += 1;
  }
  state.completed = state.stepIndex >= definition.steps.length;
  return skipped;
};

const rejected = (
  state: DeviceBuildState,
  lesson: DeviceBuildStep | null,
  category: DeviceBuildFeedbackCategory,
  explanation: string,
  errorCode: DeviceBuildResult["errorCode"],
  output: string[] = [],
  displayInput?: string,
): DeviceBuildResult => ({
  accepted: false,
  valid: category === "valid-unrelated" || category === "awaiting-confirmation",
  state: clone(state),
  output,
  explanation,
  useCase: lesson?.why ?? "Review the completed build or restart it from the Labs list.",
  verification: lesson?.verify ?? "All required lab effects have been verified.",
  rollback: category === "valid-unrelated"
    ? "The valid exploratory command remains part of simulated running state where applicable; use its targeted no form if required."
    : "Rejected input did not change simulated device state, so no rollback is required.",
  ...(lesson ? { interpretation: lesson.interpretation, commonFailure: lesson.commonFailure } : {}),
  ...(displayInput === undefined ? {} : { displayInput }),
  category,
  errorCode,
});

const parseError = (
  state: DeviceBuildState,
  lesson: DeviceBuildStep,
  parsed: Exclude<RegistryParseResult, { status: "valid" }>,
  displayInput: string,
): DeviceBuildResult => {
  switch (parsed.status) {
    case "wrong-context": return rejected(state, lesson, "wrong-context", parsed.message, "WRONG_MODE", [], displayInput);
    case "incomplete": return rejected(state, lesson, "incomplete", parsed.message, "INCOMPLETE", [], displayInput);
    case "ambiguous": return rejected(state, lesson, "ambiguous", parsed.message, "AMBIGUOUS", [], displayInput);
    case "invalid": return rejected(state, lesson, "invalid", parsed.message, "WRONG_COMMAND", parsed.message.split("\n"), displayInput);
  }
};

const finishSaveConfirmation = (
  state: DeviceBuildState,
  lesson: DeviceBuildStep,
  definition: DeviceBuildDefinition,
  raw: string,
  displayInput: string,
): DeviceBuildResult => {
  const execution = executeShared(state, raw);
  state.device = execution.state;
  syncDerivedState(state);
  if (!execution.accepted) {
    return rejected(
      state,
      lesson,
      "invalid-value",
      execution.output.join(" "),
      "INVALID_VALUE",
      execution.output,
      displayInput,
    );
  }

  const saveStep = definition.steps.find((step) =>
    /^copy running-config startup-config$/iu.test(step.command));
  if (saveStep && lesson.id === saveStep.id
    && executionSatisfiesStep(saveStep, execution) && !state.effects.includes(saveStep.id)) {
    state.effects.push(saveStep.id);
  }
  if (!saveStep || lesson.id !== saveStep.id) {
    return {
      accepted: false,
      valid: true,
      state,
      output: execution.output,
      explanation: "The running configuration was saved, but that valid action does not complete the current task.",
      useCase: lesson.why,
      verification: lesson.verify,
      rollback: "Saving changed only the simulator's startup snapshot; continue with the current verification task.",
      interpretation: lesson.interpretation,
      commonFailure: lesson.commonFailure,
      displayInput,
      category: "valid-unrelated",
      errorCode: "VALID_UNRELATED",
    };
  }

  const skipped = advanceAfterCompletion(state, definition);
  return {
    accepted: true,
    valid: true,
    state,
    output: execution.output,
    explanation: lesson.detail,
    useCase: lesson.why,
    verification: lesson.verify,
    rollback: lesson.rollback,
    interpretation: lesson.interpretation,
    commonFailure: lesson.commonFailure,
    displayInput,
    category: "objective-complete",
    skippedSatisfiedStepIds: skipped,
  };
};

const finishGenericConfirmation = (
  state: DeviceBuildState,
  lesson: DeviceBuildStep,
  raw: string,
  displayInput: string,
): DeviceBuildResult => {
  const pending = state.device.pendingInteraction;
  if (!pending || pending.kind === "save") {
    return rejected(state, lesson, "invalid-value", "No generic confirmation is pending.", "INVALID_VALUE", [], displayInput);
  }
  const execution = executeShared(state, raw);
  state.device = execution.state;
  syncDerivedState(state);

  // A decline and a reload with no startup snapshot are both complete,
  // non-mutating interactions even though the shared engine correctly marks
  // their requested operation as not accepted.
  const interactionClosed = state.device.pendingInteraction === null;
  if (!execution.accepted && !interactionClosed) {
    return rejected(
      state,
      lesson,
      "invalid-value",
      execution.output.join(" "),
      "INVALID_VALUE",
      execution.output,
      displayInput,
    );
  }

  return {
    accepted: false,
    valid: true,
    state,
    output: execution.output,
    explanation: execution.accepted
      ? `The confirmed ${pending.kind.replaceAll("-", " ")} operation changed only simulated device state; it did not complete the current learning task.`
      : "The confirmation was declined or could not be completed, and the pending interaction was cleared without advancing the learning task.",
    useCase: lesson.why,
    verification: lesson.verify,
    rollback: execution.accepted
      ? "Use Restore checkpoint to recover the simulator state captured immediately before this broad operation."
      : "No rollback is required because the broad operation did not change simulated device state.",
    interpretation: lesson.interpretation,
    commonFailure: lesson.commonFailure,
    displayInput,
    category: "valid-unrelated",
    errorCode: "VALID_UNRELATED",
  };
};

export const runDeviceBuildCommand = (current: DeviceBuildState, raw: string): DeviceBuildResult => {
  const restored = restoreDeviceBuildState(current);
  if (!restored) throw new Error("Invalid device build state");
  const state = clone(restored);
  const definition = definitionForState(state);
  const lesson = definition.steps[state.stepIndex] ?? null;
  if (!lesson) return rejected(state, null, "complete", "This guided build is already complete.", "COMPLETE");

  const registry = registryFor(state.labId, state.seed);
  const displayInput = redactRegistryInput(registry, raw, state.mode);
  if (state.device.pendingInteraction?.kind === "save") {
    return finishSaveConfirmation(state, lesson, definition, raw, displayInput);
  }
  if (state.device.pendingInteraction) return finishGenericConfirmation(state, lesson, raw, displayInput);

  if (!raw.trim()) return rejected(state, lesson, "invalid", "Enter a command at the current prompt.", "EMPTY", [], displayInput);
  if (raw.length > 256) return rejected(state, lesson, "invalid", "The simulator accepts at most 256 characters.", "TOO_LONG", [], displayInput);
  const parsed = parseRegistryInput(registry, raw, state.mode);
  if (parsed.status !== "valid") return parseError(state, lesson, parsed, displayInput);

  const matchesCurrent = eventMatchesStep(registry, parsed.event, lesson);
  const matchingStep = stepMatchingEvent(definition, registry, parsed.event);
  const execution = executeShared(state, raw);
  if (!execution.accepted) {
    return rejected(
      state,
      lesson,
      "invalid-value",
      execution.output.join(" "),
      "INVALID_VALUE",
      execution.output,
      displayInput,
    );
  }
  state.device = execution.state;
  syncDerivedState(state);
  const matchingStepSatisfied = matchingStep ? executionSatisfiesStep(matchingStep, execution) : false;
  const isTimeSensitiveFutureSave = matchingStep
    && /^copy running-config startup-config$/iu.test(matchingStep.command)
    && matchingStep.id !== lesson.id;
  if (matchingStep && matchingStepSatisfied && !isTimeSensitiveFutureSave && !state.effects.includes(matchingStep.id)) {
    state.effects.push(matchingStep.id);
  }

  const awaitingCurrentSave = matchesCurrent
    && /^copy running-config startup-config$/iu.test(lesson.command)
    && !/^write(?: memory)?$/iu.test(parsed.event.canonicalInput)
    && state.pendingConfirmation === "save-startup";
  const currentStepSatisfied = matchesCurrent && executionSatisfiesStep(lesson, execution);
  if (currentStepSatisfied && !state.effects.includes(lesson.id)) state.effects.push(lesson.id);

  if (!matchesCurrent || (!awaitingCurrentSave && !currentStepSatisfied)) {
    const awaitingExploratoryConfirmation = state.device.pendingInteraction !== null;
    return {
      accepted: false,
      valid: true,
      state,
      output: execution.output,
      explanation: awaitingExploratoryConfirmation
        ? "This valid exploratory command is waiting for confirmation. Confirm or decline it before entering another IOS command; it does not advance the current learning task."
        : matchesCurrent
        ? "The command ran, but the resulting device evidence does not yet satisfy this task. Use the output to identify the missing dependency."
        : "Valid command, but it does not complete this task. Its supported state or output effect was applied without an error penalty.",
      useCase: lesson.why,
      verification: lesson.verify,
      rollback: matchingStep?.rollback ?? "Read-only exploration needs no rollback; use a targeted no form for an unintended configuration change.",
      interpretation: lesson.interpretation,
      commonFailure: lesson.commonFailure,
      displayInput,
      category: awaitingExploratoryConfirmation ? "awaiting-confirmation" : "valid-unrelated",
      ...(awaitingExploratoryConfirmation ? { awaitingConfirmation: true } : {}),
      errorCode: "VALID_UNRELATED",
    };
  }

  if (/^copy running-config startup-config$/iu.test(lesson.command)
    && !/^write(?: memory)?$/iu.test(parsed.event.canonicalInput)) {
    return {
      accepted: false,
      valid: true,
      state,
      output: execution.output,
      explanation: "The copy command is valid. Press Enter to accept the displayed startup-config destination and complete the snapshot.",
      useCase: lesson.why,
      verification: lesson.verify,
      rollback: "Startup state has not changed while the confirmation is pending.",
      interpretation: lesson.interpretation,
      commonFailure: lesson.commonFailure,
      displayInput,
      category: "awaiting-confirmation",
      awaitingConfirmation: true,
    };
  }

  const skipped = advanceAfterCompletion(state, definition);
  return {
    accepted: true,
    valid: true,
    state,
    output: execution.output,
    explanation: lesson.detail,
    useCase: lesson.why,
    verification: lesson.verify,
    rollback: lesson.rollback,
    interpretation: lesson.interpretation,
    commonFailure: lesson.commonFailure,
    displayInput,
    category: "objective-complete",
    skippedSatisfiedStepIds: skipped,
  };
};

/**
 * Restore the shared engine checkpoint without changing the guided step or
 * awarding mastery. The UI can expose this whenever `device.recoveryCheckpoint`
 * is present after reload, erase, default-interface or configure-replace work.
 */
export const restoreDeviceBuildCheckpoint = (current: DeviceBuildState): DeviceBuildResult => {
  const restored = restoreDeviceBuildState(current);
  if (!restored) throw new Error("Invalid device build state");
  const state = clone(restored);
  const lesson = getDeviceBuildStep(state);
  const execution = restoreDeviceCheckpoint(state.device);
  state.device = execution.state;
  syncDerivedState(state);
  return {
    accepted: false,
    valid: execution.accepted,
    state,
    output: execution.output,
    explanation: execution.accepted
      ? "The previous simulated running state was restored. The guided learning position and mastery evidence were not advanced."
      : execution.output.join(" "),
    useCase: lesson?.why ?? "Recovery remains available after the guided build so broad simulator changes can be reversed safely.",
    verification: lesson?.verify ?? "Inspect the running configuration to verify the restored state.",
    rollback: execution.accepted
      ? "The one-use recovery checkpoint has now been consumed; verify the restored state before continuing."
      : "No state changed because no valid recovery checkpoint was available.",
    ...(lesson ? { interpretation: lesson.interpretation, commonFailure: lesson.commonFailure } : {}),
    category: execution.accepted ? "valid-unrelated" : "invalid-value",
    errorCode: execution.accepted ? "VALID_UNRELATED" : "INVALID_VALUE",
  };
};

/** Cancel an interactive prompt (for example Ctrl+C) without changing device state. */
export const cancelDeviceBuildPendingInteraction = (current: DeviceBuildState): DeviceBuildResult => {
  const restored = restoreDeviceBuildState(current);
  if (!restored) throw new Error("Invalid device build state");
  const state = clone(restored);
  const lesson = getDeviceBuildStep(state);
  if (!state.device.pendingInteraction) {
    return rejected(state, lesson, "invalid-value", "No interactive operation is pending.", "INVALID_VALUE");
  }
  state.device.pendingInteraction = null;
  syncDerivedState(state);
  return {
    accepted: false,
    valid: true,
    state,
    output: ["% Operation interrupted; no pending change was applied."],
    explanation: "The interactive operation was cancelled without changing simulated device state or advancing the learning task.",
    useCase: lesson?.why ?? "Cancel an interactive prompt when its impact has not been verified.",
    verification: lesson?.verify ?? "Confirm that no pending interaction remains.",
    rollback: "No rollback is required because the pending operation was not applied.",
    ...(lesson ? { interpretation: lesson.interpretation, commonFailure: lesson.commonFailure } : {}),
    category: "valid-unrelated",
    errorCode: "VALID_UNRELATED",
  };
};

export interface DeviceBuildHint {
  heading: string;
  explanation: string;
  example: string | null;
  revealed: boolean;
}

export const getDeviceBuildHint = (
  state: DeviceBuildState,
  level: 1 | 2 | 3,
): DeviceBuildHint => {
  const lesson = getDeviceBuildStep(state);
  if (!lesson) return { heading: "Build complete", explanation: "Review the verified build or restart it from the Labs list.", example: null, revealed: false };
  if (level === 1) return { heading: "Hint 1 · reason from the outcome", explanation: lesson.hint1, example: null, revealed: false };
  if (level === 2) return { heading: "Hint 2 · command family and shape", explanation: lesson.hint2, example: null, revealed: false };
  return { heading: "Correct command", explanation: `${lesson.detail} Type the command yourself; revealing it does not earn mastery credit.`, example: lesson.command, revealed: true };
};

export const completeDeviceBuildInput = (
  state: DeviceBuildState,
  input: string,
): CliCompletion => completeCliInput(
  input,
  state.mode,
  fullCatalogue(state.labId, state.seed),
  definitionForState(state).deviceProfile,
);

export const getDeviceBuildCliHelp = (
  state: DeviceBuildState,
  input: string,
): CliHelp => cliHelp(
  input,
  state.mode,
  fullCatalogue(state.labId, state.seed),
  definitionForState(state).deviceProfile,
);

export const redactDeviceBuildInput = (state: DeviceBuildState, input: string): string =>
  redactRegistryInput(registryFor(state.labId, state.seed), input, state.mode);

export const deviceBuildContextName = (state: DeviceBuildState): string => modeNames[state.mode];
