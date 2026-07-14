/**
 * Deterministic, local-only IPv4 operations lab.
 *
 * Input is parsed by the shared IOS-style registry and applied only to the
 * in-memory training state below. Player text is never executed by a shell,
 * evaluator, database, browser HTML sink or real network device.
 */

import { cliHelp, completeCliInput, type CliCompletion, type CliHelp } from "./cli-assistance.ts";
import {
  buildCommandRegistry,
  parseRegistryInput,
  redactRegistryInput,
  type ParsedCommandEvent,
  type RegistryCommand,
  type RegistryContext,
  type RegistryParseResult,
} from "./command-registry.ts";
import { getDeviceProfile, normaliseInterfaceName } from "./device-profiles.ts";
import { commands } from "./engine.ts";

export type Ipv4ScenarioMode = "user" | "privileged" | "global" | "interface";

/** Kept as a union for saved-session/API compatibility; the rebuilt lab starts with the missing-route fault. */
export type Ipv4ScenarioFault = "missing-default-route" | "wrong-default-next-hop";

export type Ipv4ScenarioPhase =
  | "gain-privilege"
  | "baseline-interface"
  | "inspect-running-interface"
  | "enter-global"
  | "select-interface"
  | "configure-description"
  | "configure-address"
  | "enable-interface"
  | "return-to-exec"
  | "verify-interface"
  | "verify-connected-routes"
  | "test-local-peer"
  | "test-remote-before-route"
  | "inspect-routing-table"
  | "diagnose-routing-fault"
  | "enter-route-configuration"
  | "install-default-route"
  | "verify-default-route"
  | "verify-remote-success"
  | "remove-default-route"
  | "verify-remote-failure"
  | "recover-default-route"
  | "verify-recovered-route"
  | "verify-recovered-remote"
  | "exit-recovery-configuration"
  | "begin-save"
  | "confirm-save"
  | "complete";

export type Ipv4ScenarioChoiceId =
  | "interface-operational"
  | "interface-administratively-down"
  | "interface-physical-fault"
  | "interface-address-missing"
  | "missing-default-route"
  | "wrong-default-next-hop"
  | "remote-host-fault"
  | "dns-fault"
  | "rollback-complete"
  | "rollback-incomplete-address"
  | "rollback-incomplete-state";

export interface Ipv4ScenarioParameters {
  /** Short IOS form deliberately used in the work order so it is quick to type. */
  interfaceName: string;
  interfaceCanonical: string;
  description: string;
  localAddress: string;
  localPeer: string;
  subnetMask: string;
  prefixLength: number;
  networkAddress: string;
  wanInterface: string;
  wanInterfaceCanonical: string;
  wanAddress: string;
  wanMask: string;
  wanNetworkAddress: string;
  gateway: string;
  /** Retained for old UI topology/API compatibility; it is not installed initially. */
  wrongGateway: string;
  remoteTarget: string;
}

export interface Ipv4InterfaceState {
  description: string;
  address: string | null;
  mask: string | null;
  adminUp: boolean;
  physicalUp: boolean;
}

export interface Ipv4StartupSnapshot {
  interfaceState: Ipv4InterfaceState;
  defaultRoute: string | null;
  configuration: string;
  savedAtAction: number;
}

export type Ipv4ScenarioPendingConfirmation =
  | "save-startup"
  | "reload"
  | "erase-startup"
  | "default-interface"
  | null;

/** Bounded device-state checkpoint; it deliberately excludes lesson progress. */
export interface Ipv4ScenarioRecoveryCheckpoint {
  mode: Ipv4ScenarioMode;
  selectedInterface: string | null;
  interfaceState: Ipv4InterfaceState;
  wanInterfaceState: Ipv4InterfaceState;
  defaultRoute: string | null;
  arpNextHopPresent: boolean;
  remoteReturnPathPresent: boolean;
  startup: Ipv4StartupSnapshot | null;
}

export interface Ipv4ScenarioState {
  version: 4;
  seed: number;
  hostname: "R1";
  mode: Ipv4ScenarioMode;
  phase: Ipv4ScenarioPhase;
  parameters: Ipv4ScenarioParameters;
  fault: Ipv4ScenarioFault;
  selectedInterface: string | null;
  interfaceState: Ipv4InterfaceState;
  wanInterfaceState: Ipv4InterfaceState;
  defaultRoute: string | null;
  arpNextHopPresent: boolean;
  remoteReturnPathPresent: boolean;
  startup: Ipv4StartupSnapshot | null;
  pendingConfirmation: Ipv4ScenarioPendingConfirmation;
  pendingInterface: string | null;
  pendingConfirmationAdvances: boolean;
  recoveryCheckpoint: Ipv4ScenarioRecoveryCheckpoint | null;
  /** Retained at zero for backwards-compatible saved-state/UI consumers. */
  subActionIndex: number;
  /** Number of the twenty-six single-action steps completed. */
  acceptedActions: number;
  migrationNotice: string | null;
}

export type Ipv4ScenarioErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "UNSUPPORTED"
  | "AMBIGUOUS"
  | "INCOMPLETE"
  | "WRONG_MODE"
  | "WRONG_STEP"
  | "INVALID_SYNTAX"
  | "INVALID_IPV4"
  | "INVALID_MASK"
  | "WRONG_VALUE"
  | "INTERPRETATION_REQUIRED"
  | "COMMAND_REQUIRED"
  | "WRONG_INTERPRETATION"
  | "VALID_UNRELATED"
  | "AWAITING_CONFIRMATION"
  | "SCENARIO_COMPLETE";

export type Ipv4ScenarioFeedbackCategory =
  | "objective-complete"
  | "group-action-complete"
  | "awaiting-interpretation"
  | "awaiting-confirmation"
  | "valid-unrelated"
  | "rejected"
  | "complete";

export interface Ipv4ScenarioActionResult {
  /** True only when the current objective or one of its labelled sub-actions progressed. */
  accepted: boolean;
  /** True when the entered command was valid IOS-style input, even if it was exploratory. */
  valid?: boolean;
  state: Ipv4ScenarioState;
  output: string[];
  explanation: string;
  useCase: string;
  verification: string;
  rollback: string;
  example?: string;
  nextObjective: string;
  category?: Ipv4ScenarioFeedbackCategory;
  awaitingConfirmation?: boolean;
  displayInput?: string;
  errorCode?: Ipv4ScenarioErrorCode;
}

export interface Ipv4ScenarioChoice {
  id: Ipv4ScenarioChoiceId;
  label: string;
}

export interface Ipv4ScenarioHint {
  heading: string;
  explanation: string;
  example: string | null;
  breakdown?: Array<{ token: string; meaning: string }>;
  visualFocus: "prompt" | "interface" | "route" | "verification" | "save";
  revealed?: boolean;
  whatItDoes?: string;
  whyCorrectHere?: string;
  verification?: string;
  recovery?: string;
}

const variants: readonly Ipv4ScenarioParameters[] = [
  {
    interfaceName: "gi0/0/1",
    interfaceCanonical: "GigabitEthernet0/0/1",
    description: "BRANCH LAN",
    localAddress: "192.168.1.1",
    localPeer: "192.168.1.2",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    networkAddress: "192.168.1.0",
    wanInterface: "gi0/0/0",
    wanInterfaceCanonical: "GigabitEthernet0/0/0",
    wanAddress: "192.0.2.1",
    wanMask: "255.255.255.252",
    wanNetworkAddress: "192.0.2.0",
    gateway: "192.0.2.2",
    wrongGateway: "192.0.2.3",
    remoteTarget: "203.0.113.10",
  },
  {
    interfaceName: "fa0/0/1",
    interfaceCanonical: "FastEthernet0/0/1",
    description: "TRAINING LAN",
    localAddress: "192.168.10.1",
    localPeer: "192.168.10.2",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    networkAddress: "192.168.10.0",
    wanInterface: "gi0/0/0",
    wanInterfaceCanonical: "GigabitEthernet0/0/0",
    wanAddress: "192.0.2.1",
    wanMask: "255.255.255.252",
    wanNetworkAddress: "192.0.2.0",
    gateway: "192.0.2.2",
    wrongGateway: "192.0.2.3",
    remoteTarget: "203.0.113.10",
  },
  {
    interfaceName: "te0/1/1",
    interfaceCanonical: "TenGigabitEthernet0/1/1",
    description: "LAB CLIENTS",
    localAddress: "10.10.10.1",
    localPeer: "10.10.10.2",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    networkAddress: "10.10.10.0",
    wanInterface: "gi0/0/0",
    wanInterfaceCanonical: "GigabitEthernet0/0/0",
    wanAddress: "192.0.2.1",
    wanMask: "255.255.255.252",
    wanNetworkAddress: "192.0.2.0",
    gateway: "192.0.2.2",
    wrongGateway: "192.0.2.3",
    remoteTarget: "203.0.113.10",
  },
] as const;

const normaliseSeed = (seed: number): number => {
  if (!Number.isFinite(seed)) return 1;
  return (Math.trunc(seed) >>> 0) || 1;
};

const nextSeed = (seed: number): number => (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;

export const createIpv4Scenario = (seed = 1): Ipv4ScenarioState => {
  const stableSeed = normaliseSeed(seed);
  const parameters = variants[nextSeed(stableSeed) % variants.length];
  return {
    version: 4,
    seed: stableSeed,
    hostname: "R1",
    mode: "user",
    phase: "gain-privilege",
    parameters: { ...parameters },
    fault: "missing-default-route",
    selectedInterface: null,
    interfaceState: {
      description: "",
      address: null,
      mask: null,
      adminUp: false,
      physicalUp: true,
    },
    wanInterfaceState: {
      description: "UPSTREAM TEST LINK",
      address: parameters.wanAddress,
      mask: parameters.wanMask,
      adminUp: true,
      physicalUp: true,
    },
    defaultRoute: null,
    arpNextHopPresent: true,
    remoteReturnPathPresent: true,
    startup: null,
    pendingConfirmation: null,
    pendingInterface: null,
    pendingConfirmationAdvances: false,
    recoveryCheckpoint: null,
    subActionIndex: 0,
    acceptedActions: 0,
    migrationNotice: null,
  };
};

const cloneInterface = (state: Ipv4InterfaceState): Ipv4InterfaceState => ({ ...state });

const cloneStartup = (startup: Ipv4StartupSnapshot | null): Ipv4StartupSnapshot | null => startup
  ? { ...startup, interfaceState: cloneInterface(startup.interfaceState) }
  : null;

const cloneState = (state: Ipv4ScenarioState): Ipv4ScenarioState => ({
  ...state,
  parameters: { ...state.parameters },
  interfaceState: cloneInterface(state.interfaceState),
  wanInterfaceState: cloneInterface(state.wanInterfaceState),
  startup: cloneStartup(state.startup),
  recoveryCheckpoint: state.recoveryCheckpoint ? {
    ...state.recoveryCheckpoint,
    interfaceState: cloneInterface(state.recoveryCheckpoint.interfaceState),
    wanInterfaceState: cloneInterface(state.recoveryCheckpoint.wanInterfaceState),
    startup: cloneStartup(state.recoveryCheckpoint.startup),
  } : null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

const isIpv4 = (value: unknown): value is string => typeof value === "string"
  && ipv4Pattern.test(value)
  && value.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);

const isMask = (value: unknown): value is string => {
  if (!isIpv4(value)) return false;
  const bits = value.split(".").map((part) => Number(part).toString(2).padStart(8, "0")).join("");
  return bits.includes("1") && /^1*0*$/u.test(bits);
};

const restoreInterface = (value: unknown): Ipv4InterfaceState | null => {
  if (!isRecord(value)
    || typeof value.description !== "string"
    || value.description.length > 120
    || typeof value.adminUp !== "boolean"
    || typeof value.physicalUp !== "boolean") return null;
  const address = value.address;
  const mask = value.mask;
  if ((address === null) !== (mask === null)) return null;
  if (address !== null && (!isIpv4(address) || !isMask(mask))) return null;
  return {
    description: value.description,
    address: address as string | null,
    mask: mask as string | null,
    adminUp: value.adminUp,
    physicalUp: value.physicalUp,
  };
};

const restoreStartup = (value: unknown): Ipv4StartupSnapshot | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.configuration !== "string"
    || value.configuration.length > 4_096
    || (value.defaultRoute !== null && !isIpv4(value.defaultRoute))
    || !Number.isInteger(value.savedAtAction)
    || (value.savedAtAction as number) < 0
    || (value.savedAtAction as number) > 26) return undefined;
  const interfaceState = restoreInterface(value.interfaceState);
  if (!interfaceState) return undefined;
  return {
    interfaceState,
    defaultRoute: value.defaultRoute as string | null,
    configuration: value.configuration,
    savedAtAction: value.savedAtAction as number,
  };
};

const restoreRecoveryCheckpoint = (value: unknown): Ipv4ScenarioRecoveryCheckpoint | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value) || !modes.has(value.mode as Ipv4ScenarioMode)) return undefined;
  const interfaceState = restoreInterface(value.interfaceState);
  const wanInterfaceState = restoreInterface(value.wanInterfaceState);
  const startup = restoreStartup(value.startup);
  if (!interfaceState || !wanInterfaceState || startup === undefined) return undefined;
  if (value.defaultRoute !== null && !isIpv4(value.defaultRoute)) return undefined;
  if (typeof value.arpNextHopPresent !== "boolean" || typeof value.remoteReturnPathPresent !== "boolean") return undefined;
  if (value.selectedInterface !== null) {
    if (typeof value.selectedInterface !== "string"
      || normaliseInterfaceName(value.selectedInterface, getDeviceProfile("router-ios-xe")) !== value.selectedInterface) return undefined;
  }
  return {
    mode: value.mode as Ipv4ScenarioMode,
    selectedInterface: value.selectedInterface as string | null,
    interfaceState,
    wanInterfaceState,
    defaultRoute: value.defaultRoute as string | null,
    arpNextHopPresent: value.arpNextHopPresent,
    remoteReturnPathPresent: value.remoteReturnPathPresent,
    startup,
  };
};

const phases = new Set<Ipv4ScenarioPhase>([
  "gain-privilege", "baseline-interface", "inspect-running-interface", "enter-global",
  "select-interface", "configure-description", "configure-address", "enable-interface",
  "return-to-exec", "verify-interface", "verify-connected-routes", "test-local-peer",
  "test-remote-before-route", "inspect-routing-table", "diagnose-routing-fault",
  "enter-route-configuration", "install-default-route", "verify-default-route",
  "verify-remote-success", "remove-default-route", "verify-remote-failure",
  "recover-default-route", "verify-recovered-route", "verify-recovered-remote",
  "exit-recovery-configuration", "begin-save", "confirm-save", "complete",
]);

type LegacyIpv4ScenarioPhase = Exclude<
  Ipv4ScenarioPhase,
  | "enter-route-configuration"
  | "recover-default-route"
  | "verify-recovered-route"
  | "verify-recovered-remote"
  | "exit-recovery-configuration"
  | "begin-save"
  | "confirm-save"
> | "recover-and-save";

const legacyPhases = new Set<LegacyIpv4ScenarioPhase>([
  "gain-privilege", "baseline-interface", "inspect-running-interface", "enter-global",
  "select-interface", "configure-description", "configure-address", "enable-interface",
  "return-to-exec", "verify-interface", "verify-connected-routes", "test-local-peer",
  "test-remote-before-route", "inspect-routing-table", "diagnose-routing-fault",
  "install-default-route", "verify-default-route", "verify-remote-success",
  "remove-default-route", "verify-remote-failure", "recover-and-save", "complete",
]);

const modes = new Set<Ipv4ScenarioMode>(["user", "privileged", "global", "interface"]);

const phaseProgress: Readonly<Record<Ipv4ScenarioPhase, number>> = {
  "gain-privilege": 0,
  "baseline-interface": 1,
  "inspect-running-interface": 2,
  "enter-global": 3,
  "select-interface": 4,
  "configure-description": 5,
  "configure-address": 6,
  "enable-interface": 7,
  "return-to-exec": 8,
  "verify-interface": 9,
  "verify-connected-routes": 10,
  "test-local-peer": 11,
  "test-remote-before-route": 12,
  "inspect-routing-table": 13,
  "diagnose-routing-fault": 13,
  "enter-route-configuration": 14,
  "install-default-route": 15,
  "verify-default-route": 16,
  "verify-remote-success": 17,
  "remove-default-route": 18,
  "verify-remote-failure": 19,
  "recover-default-route": 20,
  "verify-recovered-route": 21,
  "verify-recovered-remote": 22,
  "exit-recovery-configuration": 23,
  "begin-save": 24,
  "confirm-save": 25,
  complete: 26,
};

const legacyPhaseProgress: Readonly<Record<LegacyIpv4ScenarioPhase, number>> = {
  "gain-privilege": 0,
  "baseline-interface": 1,
  "inspect-running-interface": 2,
  "enter-global": 3,
  "select-interface": 4,
  "configure-description": 5,
  "configure-address": 6,
  "enable-interface": 7,
  "return-to-exec": 8,
  "verify-interface": 9,
  "verify-connected-routes": 10,
  "test-local-peer": 11,
  "test-remote-before-route": 12,
  "inspect-routing-table": 13,
  "diagnose-routing-fault": 13,
  "install-default-route": 14,
  "verify-default-route": 15,
  "verify-remote-success": 16,
  "remove-default-route": 17,
  "verify-remote-failure": 18,
  "recover-and-save": 19,
  complete: 20,
};

const migrateVersionOne = (value: Record<string, unknown>): Ipv4ScenarioState | null => {
  // The original workflow used a different addressing plan and ordering. A
  // validated legacy envelope is deliberately restarted rather than merging
  // incompatible device state into the new operational sequence.
  if (typeof value.seed !== "number" || value.hostname !== "R1"
    || typeof value.acceptedActions !== "number" || !Number.isInteger(value.acceptedActions)
    || value.acceptedActions < 0 || value.acceptedActions > 40
    || !isRecord(value.parameters) || typeof value.phase !== "string") return null;
  const state = createIpv4Scenario(value.seed);
  state.migrationNotice = "This saved session used the earlier lab sequence. It was safely restarted with the new twenty-six-step, one-action format.";
  return state;
};

const migrateGroupedPhase = (
  phase: LegacyIpv4ScenarioPhase,
  subActionIndex: number,
  pending: unknown,
): Ipv4ScenarioPhase => {
  if (phase === "install-default-route") {
    return subActionIndex === 0 ? "enter-route-configuration" : "install-default-route";
  }
  if (phase !== "recover-and-save") return phase;
  if (subActionIndex === 0) return "recover-default-route";
  if (subActionIndex === 1) return "verify-recovered-route";
  if (subActionIndex === 2) return "verify-recovered-remote";
  if (subActionIndex === 3) return "exit-recovery-configuration";
  if (subActionIndex === 4 || pending !== "save-startup") return "begin-save";
  return "confirm-save";
};

export const restoreIpv4ScenarioState = (value: unknown): Ipv4ScenarioState | null => {
  if (!isRecord(value)) return null;
  if (value.version === undefined) return migrateVersionOne(value);
  const migratedFromGroupedFlow = value.version === 2 || value.version === 3;
  const migratedFromVersionTwo = value.version === 2;
  if ((!migratedFromGroupedFlow && value.version !== 4) || typeof value.seed !== "number") return null;
  const baseline = createIpv4Scenario(value.seed);
  if (value.hostname !== "R1"
    || !modes.has(value.mode as Ipv4ScenarioMode)
    || value.fault !== "missing-default-route"
    || !isRecord(value.parameters)
    || JSON.stringify(value.parameters) !== JSON.stringify(baseline.parameters)) return null;

  if (!Number.isInteger(value.subActionIndex)) return null;
  const rawSubActionIndex = value.subActionIndex as number;
  let phase: Ipv4ScenarioPhase;
  if (migratedFromGroupedFlow) {
    if (!legacyPhases.has(value.phase as LegacyIpv4ScenarioPhase)) return null;
    const legacyPhase = value.phase as LegacyIpv4ScenarioPhase;
    if (!Number.isInteger(value.acceptedActions)
      || value.acceptedActions !== legacyPhaseProgress[legacyPhase]
      || rawSubActionIndex < 0 || rawSubActionIndex > 6
      || (legacyPhase !== "install-default-route" && legacyPhase !== "recover-and-save" && rawSubActionIndex !== 0)
      || (legacyPhase === "install-default-route" && rawSubActionIndex > 1)) return null;
    phase = migrateGroupedPhase(legacyPhase, rawSubActionIndex, value.pendingConfirmation);
  } else {
    if (!phases.has(value.phase as Ipv4ScenarioPhase)) return null;
    phase = value.phase as Ipv4ScenarioPhase;
    if (!Number.isInteger(value.acceptedActions)
      || value.acceptedActions !== phaseProgress[phase]
      || rawSubActionIndex !== 0) return null;
  }

  const interfaceState = restoreInterface(value.interfaceState);
  const wanInterfaceState = restoreInterface(value.wanInterfaceState);
  if (!interfaceState || !wanInterfaceState) return null;
  if (value.defaultRoute !== null && !isIpv4(value.defaultRoute)) return null;
  if (typeof value.arpNextHopPresent !== "boolean" || typeof value.remoteReturnPathPresent !== "boolean") return null;
  if (value.selectedInterface !== null) {
    if (typeof value.selectedInterface !== "string"
      || normaliseInterfaceName(value.selectedInterface, getDeviceProfile("router-ios-xe")) !== value.selectedInterface) return null;
  }
  const pending = value.pendingConfirmation;
  const allowedPending: readonly Ipv4ScenarioPendingConfirmation[] = migratedFromVersionTwo
    ? [null, "save-startup"]
    : [null, "save-startup", "reload", "erase-startup", "default-interface"];
  if (!allowedPending.includes(pending as Ipv4ScenarioPendingConfirmation)) return null;
  if (phase === "complete" && pending !== null) return null;
  if (typeof value.pendingConfirmationAdvances !== "boolean") return null;
  if (migratedFromGroupedFlow) {
    if (value.pendingConfirmationAdvances
      && (pending !== "save-startup" || value.phase !== "recover-and-save" || rawSubActionIndex !== 5)) return null;
    if (pending === "save-startup" && value.phase === "recover-and-save" && rawSubActionIndex === 5
      && value.pendingConfirmationAdvances !== true) return null;
    if (migratedFromVersionTwo && value.pendingConfirmationAdvances !== (pending === "save-startup")) return null;
  } else {
    if (value.pendingConfirmationAdvances
      && (pending !== "save-startup" || phase !== "confirm-save")) return null;
    if (phase === "confirm-save"
      && (pending !== "save-startup" || value.pendingConfirmationAdvances !== true)) return null;
  }

  const pendingInterface = migratedFromVersionTwo ? null : value.pendingInterface;
  if (pending === "default-interface") {
    if (typeof pendingInterface !== "string"
      || normaliseInterfaceName(pendingInterface, getDeviceProfile("router-ios-xe")) !== pendingInterface) return null;
  } else if (pendingInterface !== null) return null;

  const startup = restoreStartup(value.startup);
  if (startup === undefined) return null;
  const recoveryCheckpoint = migratedFromVersionTwo
    ? null
    : restoreRecoveryCheckpoint(value.recoveryCheckpoint);
  if (recoveryCheckpoint === undefined) return null;
  if ((pending === "reload" || pending === "erase-startup" || pending === "default-interface")
    && recoveryCheckpoint === null) return null;

  if (value.migrationNotice !== null
    && (typeof value.migrationNotice !== "string" || value.migrationNotice.length > 240)) return null;

  return {
    version: 4,
    seed: baseline.seed,
    hostname: "R1",
    mode: value.mode as Ipv4ScenarioMode,
    phase,
    parameters: { ...baseline.parameters },
    fault: "missing-default-route",
    selectedInterface: value.selectedInterface as string | null,
    interfaceState,
    wanInterfaceState,
    defaultRoute: value.defaultRoute as string | null,
    arpNextHopPresent: value.arpNextHopPresent,
    remoteReturnPathPresent: value.remoteReturnPathPresent,
    startup,
    pendingConfirmation: pending as Ipv4ScenarioPendingConfirmation,
    pendingInterface: pendingInterface as string | null,
    pendingConfirmationAdvances: value.pendingConfirmationAdvances,
    recoveryCheckpoint,
    subActionIndex: 0,
    acceptedActions: phaseProgress[phase],
    migrationNotice: migratedFromGroupedFlow
      ? migratedFromVersionTwo
        ? "Saved IPv4 lab state was upgraded to the recovery-safe, twenty-six-step one-action format."
        : "Saved IPv4 lab state was upgraded to the twenty-six-step one-action format."
      : value.migrationNotice as string | null,
  };
};

export const ipv4ScenarioPrompt = (state: Ipv4ScenarioState): string => {
  switch (state.mode) {
    case "user": return `${state.hostname}>`;
    case "privileged": return `${state.hostname}#`;
    case "global": return `${state.hostname}(config)#`;
    case "interface": return `${state.hostname}(config-if)#`;
  }
};

interface ExpectedAction {
  command: string;
  context: Ipv4ScenarioMode;
  objective: string;
  reason: string;
  useCase: string;
  verify: string;
  rollback: string;
  shape: string;
  visualFocus: Ipv4ScenarioHint["visualFocus"];
}

const expectedAction = (state: Ipv4ScenarioState): ExpectedAction | null => {
  const p = state.parameters;
  const actions: Partial<Record<Ipv4ScenarioPhase, ExpectedAction>> = {
    "gain-privilege": {
      command: "enable", context: "user", objective: "Step 1 of 26 · Reach Privileged EXEC from the User EXEC prompt.",
      reason: "Operational verification and configuration entry require the privileged prompt. The prompt character changes from > to #; that context change is the evidence.",
      useCase: "Engineers raise privilege before inspecting protected operational state or opening configuration mode.",
      verify: "The prompt becomes R1# without changing the running configuration.",
      rollback: "Use disable to return to User EXEC if privileged access was entered unintentionally.",
      shape: "enable", visualFocus: "prompt",
    },
    "baseline-interface": {
      command: "show ip interface brief", context: "privileged", objective: "Step 2 of 26 · Capture a concise interface baseline before making changes.",
      reason: "A baseline separates pre-existing state from the change. Address, Status and Protocol must be read as distinct facts.",
      useCase: "Use the concise table before and after work to prove exactly what changed.",
      verify: `Confirm ${p.interfaceCanonical} is unassigned and administratively down, while ${p.wanInterfaceCanonical} remains up/up.`,
      rollback: "This command is read-only, so no rollback is required.",
      shape: "show ip interface brief", visualFocus: "interface",
    },
    "inspect-running-interface": {
      command: `show running-config interface ${p.interfaceName}`, context: "privileged", objective: `Step 3 of 26 · Inspect the current configuration of ${p.interfaceName}.`,
      reason: "The scoped running-config view proves which explicit commands already belong to the interface without exposing unrelated configuration.",
      useCase: "Scope show running-config to one interface when validating a ticket or preparing a low-risk change.",
      verify: "The interface stanza has no description or IP address and contains shutdown.",
      rollback: "This command is read-only, so no rollback is required.",
      shape: "show running-config interface <interface>", visualFocus: "interface",
    },
    "enter-global": {
      command: "configure terminal", context: "privileged", objective: "Step 4 of 26 · Enter Global Configuration mode.",
      reason: "Global Configuration is the parent context used to select the LAN interface.",
      useCase: "Enter configuration only after collecting a baseline and confirming the intended device.",
      verify: "The prompt becomes R1(config)#.", rollback: "Use end to return directly to Privileged EXEC.",
      shape: "configure terminal", visualFocus: "prompt",
    },
    "select-interface": {
      command: `interface ${p.interfaceName}`, context: "global", objective: `Step 5 of 26 · Select the LAN interface ${p.interfaceName}.`,
      reason: "Interface-scoped commands must be applied under the exact port in the work order.",
      useCase: "Selecting the wrong interface is a common and disruptive change error; verify the identifier before applying state.",
      verify: "The prompt becomes R1(config-if)# and the selected interface resolves to the declared virtual hardware port.",
      rollback: "Use exit to return one level or end to leave configuration mode.",
      shape: "interface <interface>", visualFocus: "interface",
    },
    "configure-description": {
      command: `description ${p.description}`, context: "interface", objective: `Step 6 of 26 · Describe the LAN interface as “${p.description}”.`,
      reason: "A useful description connects the physical/logical port to its operational purpose.",
      useCase: "Descriptions reduce identification time during incidents and change reviews.",
      verify: "A scoped running-config view will show the exact description under the LAN interface.",
      rollback: "Use no description in the same interface context.",
      shape: "description <text>", visualFocus: "interface",
    },
    "configure-address": {
      command: `ip address ${p.localAddress} ${p.subnetMask}`, context: "interface", objective: `Step 7 of 26 · Configure ${p.localAddress}/${p.prefixLength} on the LAN interface.`,
      reason: "IOS uses an address followed by a contiguous subnet mask; the /24 mask places the local peer in the same connected network.",
      useCase: "An interface address becomes the local gateway and creates connected and local routing-table entries once the line is operational.",
      verify: `The expected connected prefix is ${p.networkAddress}/${p.prefixLength} and the local host route is ${p.localAddress}/32.`,
      rollback: "Use no ip address in the same interface context.",
      shape: "ip address <address> <subnet-mask>", visualFocus: "interface",
    },
    "enable-interface": {
      command: "no shutdown", context: "interface", objective: "Step 8 of 26 · Administratively enable the LAN interface.",
      reason: "Removing shutdown changes the administrative state; the seeded physical carrier then permits Status and Protocol to become up.",
      useCase: "New router interfaces commonly remain administratively disabled until explicitly enabled.",
      verify: "The simulator emits a link-state message and the next concise summary should show up/up.",
      rollback: "Use shutdown to return the interface to an administratively disabled state.",
      shape: "no shutdown", visualFocus: "interface",
    },
    "return-to-exec": {
      command: "end", context: "interface", objective: "Step 9 of 26 · Return directly to Privileged EXEC for verification.",
      reason: "end leaves nested configuration contexts in one operation, making the # prompt an explicit boundary between change and verification.",
      useCase: "Separate configuration from operational checks so prompt context is unambiguous.",
      verify: "The prompt becomes R1#.", rollback: "Re-enter configure terminal and the interface context only if another change is required.",
      shape: "end", visualFocus: "prompt",
    },
    "verify-interface": {
      command: "show ip interface brief", context: "privileged", objective: "Step 10 of 26 · Confirm the configured address and up/up state.",
      reason: "Configuration is not proof of operation. Address, administrative/physical Status and line Protocol must agree.",
      useCase: "This is a fast post-change check before testing routing or application reachability.",
      verify: `${p.interfaceCanonical} should show ${p.localAddress}, up, up.`,
      rollback: "The command is read-only; correct the relevant address, administrative or physical cause instead.",
      shape: "show ip interface brief", visualFocus: "interface",
    },
    "verify-connected-routes": {
      command: "show ip route connected", context: "privileged", objective: "Step 11 of 26 · Prove the connected and local LAN routes were installed.",
      reason: "An operational addressed interface installs a connected subnet route (C) and a /32 local address route (L).",
      useCase: "Checking the routing table verifies the control-plane consequence of the interface change.",
      verify: `Find C ${p.networkAddress}/${p.prefixLength} and L ${p.localAddress}/32 on ${p.interfaceCanonical}.`,
      rollback: "This command is read-only; removing or disabling the interface address removes these derived routes.",
      shape: "show ip route connected", visualFocus: "route",
    },
    "test-local-peer": {
      command: `ping ${p.localPeer}`, context: "privileged", objective: `Step 12 of 26 · Test the local LAN peer at ${p.localPeer}.`,
      reason: "A local ping exercises the interface, subnet decision and directly connected neighbour path before remote routing is introduced.",
      useCase: "Test the nearest dependency first; it narrows faults before adding upstream routing to the investigation.",
      verify: "Five replies and a 100 percent success rate prove the seeded local peer path.",
      rollback: "Ping is read-only; no rollback is required.",
      shape: "ping <local-peer-address>", visualFocus: "verification",
    },
    "test-remote-before-route": {
      command: `ping ${p.remoteTarget}`, context: "privileged", objective: `Step 13 of 26 · Test remote reachability to ${p.remoteTarget} before changing routes.`,
      reason: "The deliberate failure establishes a symptom. It must be correlated with the routing table rather than guessed from ping alone.",
      useCase: "Reproduce and record the failure before repair so the same probe can validate the result afterwards.",
      verify: "The ping fails with a cause stating that no default route matches the remote destination.",
      rollback: "Ping is read-only; no rollback is required.",
      shape: "ping <remote-address>", visualFocus: "verification",
    },
    "inspect-routing-table": {
      command: "show ip route", context: "privileged", objective: "Step 14 of 26 · Inspect the route table, then diagnose the missing remote path.",
      reason: "The table contains healthy connected/local routes but explicitly says that the gateway of last resort is not set.",
      useCase: "Route-table evidence distinguishes a forwarding-path problem from DNS or an unsupported remote-host assumption.",
      verify: "After the command, select the diagnosis supported by the displayed gateway and prefix evidence.",
      rollback: "This command and the interpretation are read-only.",
      shape: "show ip route", visualFocus: "route",
    },
    "enter-route-configuration": {
      command: "configure terminal", context: "privileged", objective: "Step 15 of 26 · Enter Global Configuration to repair the missing route.",
      reason: "The route is global configuration, so the prompt must change to R1(config)# before the route can be installed.",
      useCase: "Keep context transitions as explicit actions so the prompt proves where the next change will apply.",
      verify: "Confirm the prompt changes to R1(config)# without changing the routing table yet.",
      rollback: "Leave configuration with end if the repair is cancelled before installing a route.",
      shape: "configure terminal", visualFocus: "prompt",
    },
    "install-default-route": {
      command: `ip route 0.0.0.0 0.0.0.0 ${p.gateway}`, context: "global", objective: `Step 16 of 26 · Add the default route through ${p.gateway}.`,
      reason: "Destination 0.0.0.0 with mask 0.0.0.0 is /0, the least-specific IPv4 route. The next hop must be the documented, connected WAN neighbour.",
      useCase: "A branch router often uses a static gateway of last resort for destinations not present as more-specific routes.",
      verify: "The following do show ip route check must show S* 0.0.0.0/0 through the exact next hop.",
      rollback: `Use no ip route 0.0.0.0 0.0.0.0 ${p.gateway} to remove this exact static route.`,
      shape: "ip route 0.0.0.0 0.0.0.0 <next-hop>", visualFocus: "route",
    },
    "verify-default-route": {
      command: "do show ip route", context: "global", objective: "Step 17 of 26 · Verify the default route without leaving configuration mode.",
      reason: "do runs a Privileged EXEC verification command from a configuration prompt; it does not change the current configuration context.",
      useCase: "Use do for immediate evidence while retaining the context needed for a targeted correction or rollback.",
      verify: `Find gateway of last resort ${p.gateway} and S* 0.0.0.0/0 via ${p.gateway}.`,
      rollback: "The show command is read-only; remove the exact route if its evidence is wrong.",
      shape: "do show ip route", visualFocus: "route",
    },
    "verify-remote-success": {
      command: `do ping ${p.remoteTarget}`, context: "global", objective: `Step 18 of 26 · Retest ${p.remoteTarget} from the current configuration prompt.`,
      reason: "The same failed-before probe now validates the route, connected next hop, ARP resolution and deterministic return path.",
      useCase: "A controlled before/after probe is stronger evidence than assuming a route-table entry guarantees end-to-end reachability.",
      verify: "Five replies and the cause trace show the default route, resolved next hop and return path.",
      rollback: "Ping is read-only; the next step deliberately removes the route to test failure and recovery.",
      shape: "do ping <remote-address>", visualFocus: "verification",
    },
    "remove-default-route": {
      command: `no ip route 0.0.0.0 0.0.0.0 ${p.gateway}`, context: "global", objective: "Step 19 of 26 · Remove the exact default route while preserving connected and local routes.",
      reason: "IOS no-form removal mirrors the complete configured statement. It removes only that static /0, not routes derived from interface addresses.",
      useCase: "Exact no-form rollback avoids deleting a different route or disturbing the healthy LAN configuration.",
      verify: "The default route becomes absent while the connected and local LAN/WAN routes remain.",
      rollback: `Re-add ip route 0.0.0.0 0.0.0.0 ${p.gateway}.`,
      shape: "no ip route 0.0.0.0 0.0.0.0 <next-hop>", visualFocus: "route",
    },
    "verify-remote-failure": {
      command: `do ping ${p.remoteTarget}`, context: "global", objective: "Step 20 of 26 · Prove the remote test fails again after the exact route removal.",
      reason: "The controlled failure demonstrates causality: connected routes remain healthy, but the remote destination again has no matching route.",
      useCase: "A negative verification confirms that the intended configuration object, rather than an unrelated change, controlled the result.",
      verify: "The output reports zero replies and specifically identifies the missing default route.",
      rollback: "Restore the exact default route in the next action, then verify it before saving.",
      shape: "do ping <remote-address>", visualFocus: "verification",
    },
    "recover-default-route": {
      command: `ip route 0.0.0.0 0.0.0.0 ${p.gateway}`, context: "global",
      objective: "Step 21 of 26 · Restore the exact default route.",
      reason: "Recovery begins by reinstating the known-good next hop proven earlier.", useCase: "Restore the smallest verified configuration object first.",
      verify: "The next action checks the route table before reachability is trusted.", rollback: `Use no ip route 0.0.0.0 0.0.0.0 ${p.gateway}.`,
      shape: "ip route 0.0.0.0 0.0.0.0 <next-hop>", visualFocus: "route",
    },
    "verify-recovered-route": {
      command: "do show ip route", context: "global",
      objective: "Step 22 of 26 · Verify the restored route.",
      reason: "Route-table evidence must precede the end-to-end probe.", useCase: "Layer verification from control-plane state towards service reachability.",
      verify: `S* 0.0.0.0/0 must point to ${p.gateway}.`, rollback: "This show command is read-only.",
      shape: "do show ip route", visualFocus: "route",
    },
    "verify-recovered-remote": {
      command: `do ping ${p.remoteTarget}`, context: "global",
      objective: "Step 23 of 26 · Prove remote reachability is restored.",
      reason: "A successful repeat of the original probe completes operational recovery evidence.", useCase: "Use the same target and success criteria as the pre-change failure.",
      verify: "Five of five probes must return through the deterministic remote return path.", rollback: "Ping is read-only and requires no configuration rollback.",
      shape: "do ping <remote-address>", visualFocus: "verification",
    },
    "exit-recovery-configuration": {
      command: "end", context: "global",
      objective: "Step 24 of 26 · Return to Privileged EXEC after verification.",
      reason: "The configuration phase is complete and verified; saving is performed from the Privileged EXEC prompt.", useCase: "Make prompt context explicit before a persistence operation.",
      verify: "The prompt becomes R1#.", rollback: "Re-enter configuration mode only if further correction is required.",
      shape: "end", visualFocus: "prompt",
    },
    "begin-save": {
      command: "copy running-config startup-config", context: "privileged",
      objective: "Step 25 of 26 · Start saving the verified running configuration.",
      reason: "The copy operation asks for a destination confirmation before changing startup state.", useCase: "Persist only a configuration that has passed both route and reachability checks.",
      verify: "The terminal displays Destination filename [startup-config]?.", rollback: "Before confirmation, startup state has not changed.",
      shape: "copy running-config startup-config", visualFocus: "save",
    },
    "confirm-save": {
      command: "", context: "privileged",
      objective: "Step 26 of 26 · Press Enter to accept startup-config.",
      reason: "An empty confirmation accepts the destination displayed in square brackets and commits the verified recovery snapshot.", useCase: "Interactive IOS operations require reading and responding to prompts, not blindly entering another command.",
      verify: "Building configuration... and [OK] confirm that startup state now matches the verified running state.", rollback: "Correct running state and save again, or restore a known-good startup snapshot.",
      shape: "<Enter>", visualFocus: "save",
    },
  };
  return actions[state.phase] ?? null;
};

export const getIpv4ScenarioObjective = (state: Ipv4ScenarioState): string => {
  if (state.phase === "diagnose-routing-fault") {
    return "Step 14 of 26 · Diagnose the missing gateway of last resort from the displayed route table.";
  }
  if (state.phase === "complete") {
    return "Lab complete · The twenty-six-step configure, diagnose, prove, remove, recover and save lifecycle is verified.";
  }
  return expectedAction(state)?.objective ?? "Continue the IPv4 operational workflow.";
};

export const getIpv4ScenarioChoices = (state: Ipv4ScenarioState): Ipv4ScenarioChoice[] =>
  state.phase === "diagnose-routing-fault" ? [
    { id: "missing-default-route", label: "The connected routes are healthy, but no gateway of last resort is installed." },
    { id: "wrong-default-next-hop", label: "A default route is present but points to the wrong next hop." },
    { id: "remote-host-fault", label: "The route table proves that the remote host is powered off." },
    { id: "dns-fault", label: "DNS is preventing a ping to the numeric IPv4 address." },
  ] : [];

const hintBreakdown = (action: ExpectedAction): Array<{ token: string; meaning: string }> => {
  if (/^(?:no )?ip route /u.test(action.command)) return [
    ...(action.command.startsWith("no ") ? [{ token: "no", meaning: "Remove the exact matching configuration statement" }] : []),
    { token: "ip route", meaning: "Static IPv4 route configuration family" },
    { token: "0.0.0.0", meaning: "Destination network for the default route" },
    { token: "0.0.0.0", meaning: "Subnet mask /0, the least-specific match" },
    { token: "<next-hop>", meaning: "Reachable adjacent WAN gateway from the work order" },
  ];
  if (action.command.startsWith("ip address ")) return [
    { token: "ip address", meaning: "Assign IPv4 Layer 3 state to the selected interface" },
    { token: "<address>", meaning: "Interface address from the work order" },
    { token: "<subnet-mask>", meaning: "Contiguous subnet mask, not a wildcard mask" },
  ];
  return action.shape.split(" ").map((token) => ({ token, meaning: token.startsWith("<") ? "Variable or interactive value" : "IOS command keyword" }));
};

export const getIpv4ScenarioHint = (
  state: Ipv4ScenarioState,
  level: 1 | 2 | 3,
): Ipv4ScenarioHint => {
  if (state.phase === "diagnose-routing-fault") {
    if (level === 1) return {
      heading: "Hint 1 · Follow the forwarding evidence",
      explanation: "The local connected and /32 routes prove the LAN change worked. A numeric-address ping does not use DNS. Find what the route table says about destinations that have no more-specific match.",
      example: null, visualFocus: "route", revealed: false,
    };
    if (level === 2) return {
      heading: "Hint 2 · Read the gateway line",
      explanation: "Compare “Gateway of last resort is not set” with the absence of an S* 0.0.0.0/0 entry. Choose the diagnosis that describes that missing least-specific path.",
      example: null, visualFocus: "route", revealed: false,
    };
    return {
      heading: "Correct diagnosis revealed",
      explanation: "Choose: The connected routes are healthy, but no gateway of last resort is installed. A revealed diagnosis is assisted learning and should be followed by a later clean-recall check.",
      example: "The connected routes are healthy, but no gateway of last resort is installed.",
      visualFocus: "route", revealed: true,
      whatItDoes: "Identifies the forwarding-table fact that prevents the remote destination from matching a usable route.",
      whyCorrectHere: "The output shows healthy connected and local routes but explicitly states that the gateway of last resort is not set.",
      verification: "Check that no S* 0.0.0.0/0 entry exists before the repair.",
      recovery: "A diagnosis changes no device state; the next task adds the smallest necessary route.",
    };
  }
  const action = expectedAction(state);
  if (!action) return {
    heading: "Lab complete", explanation: "Review the evidence or restart the lab for another deterministic addressing variant.",
    example: null, visualFocus: "save", revealed: false,
  };
  if (level === 1) return {
    heading: "Hint 1 · Reason from the required outcome",
    explanation: `${action.reason} Use the current ${ipv4ScenarioPrompt(state)} prompt to decide which command family belongs here.`,
    example: null, visualFocus: action.visualFocus, revealed: false,
  };
  if (level === 2) return {
    heading: "Hint 2 · Command family and shape",
    explanation: `Build this IOS-style shape without copying objective values: ${action.shape}. Tab completes only an unambiguous keyword; ? displays the current grammar branch.`,
    example: null, breakdown: hintBreakdown(action), visualFocus: action.visualFocus, revealed: false,
  };
  return {
    heading: "Correct action revealed",
    explanation: "Type the action yourself and study how each token maps to the work order. A revealed answer is assisted and must not earn clean-recall mastery credit.",
    example: action.command || "Press Enter",
    breakdown: hintBreakdown(action), visualFocus: action.visualFocus, revealed: true,
    whatItDoes: action.useCase,
    whyCorrectHere: action.reason,
    verification: action.verify,
    recovery: action.rollback,
  };
};

const scenarioCommand = (
  id: string,
  mode: RegistryContext,
  canonical: string,
  kind: RegistryCommand["kind"],
): RegistryCommand => ({
  id: `ipv4-lab.${id}`,
  mode,
  canonical,
  objective: "Execute an operation in the deterministic IPv4 field lab.",
  explanation: "This bounded IOS-style command is parsed and applied only to simulated state.",
  topic: "IPv4 field lab",
  difficulty: 1,
  kind,
});

/** State-specific commands are merged with the same built-in registry used elsewhere. */
export const getIpv4ScenarioCatalogue = (state: Ipv4ScenarioState): RegistryCommand[] => {
  const p = state.parameters;
  const additions: RegistryCommand[] = [
    scenarioCommand("show-running-interface", "privileged", `show running-config interface ${p.interfaceName}`, "verification"),
    scenarioCommand("show-connected", "privileged", "show ip route connected", "verification"),
    scenarioCommand("ping-local", "privileged", `ping ${p.localPeer}`, "verification"),
    scenarioCommand("ping-remote", "privileged", `ping ${p.remoteTarget}`, "verification"),
    scenarioCommand("interface", "global", `interface ${p.interfaceName}`, "navigation"),
    scenarioCommand("description", "interface", `description ${p.description}`, "configuration"),
    scenarioCommand("address", "interface", `ip address ${p.localAddress} ${p.subnetMask}`, "configuration"),
    scenarioCommand("route", "global", `ip route 0.0.0.0 0.0.0.0 ${p.gateway}`, "configuration"),
    scenarioCommand("remove-route", "global", `no ip route 0.0.0.0 0.0.0.0 ${p.gateway}`, "configuration"),
    // These explicit shapes make `do` discoverable to help/Tab. Execution is
    // still resolved by parseRegistryInput's shared configuration-mode rule.
    scenarioCommand("do-show-route", "global", "do show ip route", "verification"),
    scenarioCommand("do-ping-remote", "global", `do ping ${p.remoteTarget}`, "verification"),
  ];
  const merged = [...commands, ...additions];
  return [...new Map(merged.map((command) => [`${command.mode}:${command.canonical.toLocaleLowerCase("en-GB")}`, command])).values()];
};

const registryFor = (state: Ipv4ScenarioState) => buildCommandRegistry(
  getIpv4ScenarioCatalogue(state),
  getDeviceProfile("router-ios-xe"),
  { includeSupplemental: true },
);

export const completeIpv4ScenarioInput = (state: Ipv4ScenarioState, raw: string): CliCompletion =>
  completeCliInput(raw, state.mode, getIpv4ScenarioCatalogue(state), "router-ios-xe");

export const getIpv4ScenarioCliHelp = (state: Ipv4ScenarioState, raw: string): CliHelp =>
  cliHelp(raw, state.mode, getIpv4ScenarioCatalogue(state), "router-ios-xe");

export const redactIpv4ScenarioInput = (state: Ipv4ScenarioState, raw: string): string =>
  redactRegistryInput(registryFor(state), raw, state.mode);

const toNumber = (address: string): number => address.split(".")
  .reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0) >>> 0;

const sameSubnet = (left: string, right: string, mask: string): boolean =>
  (toNumber(left) & toNumber(mask)) === (toNumber(right) & toNumber(mask));

const interfaceOperational = (item: Ipv4InterfaceState): boolean =>
  item.adminUp && item.physicalUp && item.address !== null && item.mask !== null;

const interfaceStatus = (item: Ipv4InterfaceState): { status: string; protocol: string } => {
  if (!item.adminUp) return { status: "administratively down", protocol: "down" };
  if (!item.physicalUp) return { status: "down", protocol: "down" };
  return { status: "up", protocol: "up" };
};

const showIpInterfaceBrief = (state: Ipv4ScenarioState): string[] => {
  const rows = [
    [state.parameters.interfaceCanonical, state.interfaceState],
    [state.parameters.wanInterfaceCanonical, state.wanInterfaceState],
  ] as const;
  return [
    "Interface                  IP-Address      OK? Method Status                Protocol",
    ...rows.map(([name, item]) => {
      const status = interfaceStatus(item);
      return `${name.padEnd(26)} ${(item.address ?? "unassigned").padEnd(15)} YES manual ${status.status.padEnd(21)} ${status.protocol}`;
    }),
  ];
};

const runningInterface = (state: Ipv4ScenarioState): string[] => {
  const item = state.interfaceState;
  return [
    "Building configuration...",
    `interface ${state.parameters.interfaceCanonical}`,
    ...(item.description ? [` description ${item.description}`] : []),
    ...(item.address && item.mask ? [` ip address ${item.address} ${item.mask}`] : []),
    item.adminUp ? " no shutdown" : " shutdown",
    "end",
  ];
};

const routeLines = (state: Ipv4ScenarioState, connectedOnly = false): string[] => {
  const p = state.parameters;
  const lines: string[] = [];
  if (!connectedOnly) {
    lines.push(state.defaultRoute
      ? `Gateway of last resort is ${state.defaultRoute} to network 0.0.0.0`
      : "Gateway of last resort is not set");
  }
  if (interfaceOperational(state.wanInterfaceState)) {
    lines.push(`C    ${p.wanNetworkAddress}/30 is directly connected, ${p.wanInterfaceCanonical}`);
    lines.push(`L    ${p.wanAddress}/32 is directly connected, ${p.wanInterfaceCanonical}`);
  }
  if (interfaceOperational(state.interfaceState)
    && state.interfaceState.address === p.localAddress
    && state.interfaceState.mask === p.subnetMask) {
    lines.push(`C    ${p.networkAddress}/${p.prefixLength} is directly connected, ${p.interfaceCanonical}`);
    lines.push(`L    ${p.localAddress}/32 is directly connected, ${p.interfaceCanonical}`);
  }
  if (!connectedOnly && state.defaultRoute) {
    lines.push(`S*   0.0.0.0/0 [1/0] via ${state.defaultRoute}`);
  }
  return lines;
};

interface PingEvidence { success: boolean; cause: string }

const localPingEvidence = (state: Ipv4ScenarioState): PingEvidence => {
  const item = state.interfaceState;
  if (!item.adminUp) return { success: false, cause: `LAN interface ${state.parameters.interfaceCanonical} is administratively down.` };
  if (!item.physicalUp) return { success: false, cause: `LAN interface ${state.parameters.interfaceCanonical} has no physical carrier.` };
  if (!item.address || !item.mask) return { success: false, cause: "The LAN interface has no complete IPv4 address and subnet mask." };
  if (item.address !== state.parameters.localAddress || item.mask !== state.parameters.subnetMask
    || !sameSubnet(item.address, state.parameters.localPeer, item.mask)) {
    return { success: false, cause: `The configured LAN address or mask does not place ${state.parameters.localPeer} on the intended connected subnet.` };
  }
  return { success: true, cause: `The local peer is reached directly through ${state.parameters.interfaceCanonical}.` };
};

const remotePingEvidence = (state: Ipv4ScenarioState): PingEvidence => {
  const wan = state.wanInterfaceState;
  const p = state.parameters;
  if (!wan.adminUp) return { success: false, cause: `WAN interface ${p.wanInterfaceCanonical} is administratively down.` };
  if (!wan.physicalUp) return { success: false, cause: `WAN interface ${p.wanInterfaceCanonical} has no physical carrier.` };
  if (!wan.address || !wan.mask) return { success: false, cause: "The WAN interface has no complete IPv4 address and subnet mask." };
  if (wan.address !== p.wanAddress || wan.mask !== p.wanMask) {
    return { success: false, cause: "The WAN address or mask is incorrect for the documented upstream subnet." };
  }
  if (!state.defaultRoute) return { success: false, cause: `No default route matches remote destination ${p.remoteTarget}.` };
  if (!sameSubnet(wan.address, state.defaultRoute, wan.mask)) {
    return { success: false, cause: `Default next hop ${state.defaultRoute} is not reachable through the connected WAN subnet.` };
  }
  if (state.defaultRoute !== p.gateway || !state.arpNextHopPresent) {
    return { success: false, cause: `ARP cannot resolve default next hop ${state.defaultRoute} on ${p.wanInterfaceCanonical}.` };
  }
  if (!state.remoteReturnPathPresent) {
    return { success: false, cause: `The forward path reaches ${p.remoteTarget}, but the deterministic remote return path is missing.` };
  }
  return { success: true, cause: `Forward path uses 0.0.0.0/0 via ${p.gateway}; ARP and the deterministic remote return path are present.` };
};

const pingOutput = (state: Ipv4ScenarioState, target: string): string[] => {
  const evidence = target === state.parameters.localPeer
    ? localPingEvidence(state)
    : remotePingEvidence(state);
  return [
    `Type escape sequence to abort. Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`,
    evidence.success ? "!!!!!" : ".....",
    `Success rate is ${evidence.success ? "100" : "0"} percent (${evidence.success ? "5/5" : "0/5"})`,
    `Simulator evidence: ${evidence.cause}`,
  ];
};

const runningConfiguration = (state: Ipv4ScenarioState): string => [
  `hostname ${state.hostname}`,
  `interface ${state.parameters.interfaceCanonical}`,
  ...(state.interfaceState.description ? [` description ${state.interfaceState.description}`] : []),
  ...(state.interfaceState.address && state.interfaceState.mask
    ? [` ip address ${state.interfaceState.address} ${state.interfaceState.mask}`]
    : []),
  state.interfaceState.adminUp ? " no shutdown" : " shutdown",
  "!",
  `interface ${state.parameters.wanInterfaceCanonical}`,
  ` ip address ${state.wanInterfaceState.address ?? "unassigned"} ${state.wanInterfaceState.mask ?? ""}`.trimEnd(),
  state.wanInterfaceState.adminUp ? " no shutdown" : " shutdown",
  ...(state.defaultRoute ? [`ip route 0.0.0.0 0.0.0.0 ${state.defaultRoute}`] : []),
  "end",
].join("\n");

const saveStartupSnapshot = (state: Ipv4ScenarioState): Ipv4StartupSnapshot => ({
  interfaceState: cloneInterface(state.interfaceState),
  defaultRoute: state.defaultRoute,
  configuration: runningConfiguration(state),
  savedAtAction: state.acceptedActions,
});

const scenarioCheckpoint = (state: Ipv4ScenarioState): Ipv4ScenarioRecoveryCheckpoint => ({
  mode: state.mode,
  selectedInterface: state.selectedInterface,
  interfaceState: cloneInterface(state.interfaceState),
  wanInterfaceState: cloneInterface(state.wanInterfaceState),
  defaultRoute: state.defaultRoute,
  arpNextHopPresent: state.arpNextHopPresent,
  remoteReturnPathPresent: state.remoteReturnPathPresent,
  startup: cloneStartup(state.startup),
});

const applyScenarioCheckpoint = (
  state: Ipv4ScenarioState,
  checkpoint: Ipv4ScenarioRecoveryCheckpoint,
): void => {
  state.mode = checkpoint.mode;
  state.selectedInterface = checkpoint.selectedInterface;
  state.interfaceState = cloneInterface(checkpoint.interfaceState);
  state.wanInterfaceState = cloneInterface(checkpoint.wanInterfaceState);
  state.defaultRoute = checkpoint.defaultRoute;
  state.arpNextHopPresent = checkpoint.arpNextHopPresent;
  state.remoteReturnPathPresent = checkpoint.remoteReturnPathPresent;
  state.startup = cloneStartup(checkpoint.startup);
};

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");

const commandOutput = (state: Ipv4ScenarioState, event: ParsedCommandEvent): string[] => {
  const command = lower(event.canonicalInput);
  if (command === "show ip interface brief") return showIpInterfaceBrief(state);
  if (/^show running-config interface /u.test(command)) return runningInterface(state);
  if (command === "show ip route connected") return routeLines(state, true);
  if (command === "show ip route" || command.startsWith("show ip route ")) return routeLines(state);
  if (command.startsWith("ping ")) return pingOutput(state, event.canonicalInput.split(" ").at(-1) ?? "");
  if (command === "show running-config") return runningConfiguration(state).split("\n");
  if (command === "show startup-config") return state.startup?.configuration.split("\n") ?? ["startup-config is not present in the simulator"];
  if (command === "show version") return ["IOS XE educational simulator, Version 17.9", "R1 uptime is 3 days, 4 hours"];
  if (command === "show interfaces" || command === "show interfaces description") return [
    `${state.parameters.interfaceCanonical} is ${interfaceStatus(state.interfaceState).status}, line protocol is ${interfaceStatus(state.interfaceState).protocol}`,
    `  Description: ${state.interfaceState.description || "--"}`,
  ];
  return [];
};

const applyEvent = (current: Ipv4ScenarioState, event: ParsedCommandEvent): { state: Ipv4ScenarioState; output: string[] } => {
  const state = cloneState(current);
  const command = lower(event.canonicalInput);
  let output: string[] = [];
  if (command === "enable") state.mode = "privileged";
  else if (command === "disable") state.mode = "user";
  else if (command === "configure terminal") state.mode = "global";
  else if (/^interface /u.test(command)) {
    const selected = event.normalisedArguments.interface ?? event.canonicalInput.split(" ").at(-1) ?? null;
    state.selectedInterface = selected;
    state.mode = "interface";
  } else if (command === "end") state.mode = "privileged";
  else if (command === "exit") {
    if (state.mode === "interface") state.mode = "global";
    else if (state.mode === "global") state.mode = "privileged";
  } else if (state.mode === "interface" && state.selectedInterface === state.parameters.interfaceCanonical) {
    if (command.startsWith("description ")) state.interfaceState.description = event.canonicalInput.replace(/^description /iu, "");
    else if (command === "no description") state.interfaceState.description = "";
    else if (command.startsWith("ip address ")) {
      const parts = event.canonicalInput.split(" ");
      state.interfaceState.address = parts[2] ?? null;
      state.interfaceState.mask = parts[3] ?? null;
    } else if (command === "no ip address") {
      state.interfaceState.address = null;
      state.interfaceState.mask = null;
    } else if (command === "no shutdown") {
      state.interfaceState.adminUp = true;
      output = [`%LINK-3-UPDOWN: Interface ${state.parameters.interfaceCanonical} changed state to ${state.interfaceState.physicalUp ? "up" : "down"}`];
    } else if (command === "shutdown") state.interfaceState.adminUp = false;
  }
  if (/^ip route /u.test(command)) {
    const parts = event.canonicalInput.split(" ");
    if (parts[2] === "0.0.0.0" && parts[3] === "0.0.0.0") state.defaultRoute = parts[4] ?? null;
  } else if (/^no ip route /u.test(command)) {
    const parts = event.canonicalInput.split(" ");
    if (parts[3] === "0.0.0.0" && parts[4] === "0.0.0.0" && state.defaultRoute === parts[5]) state.defaultRoute = null;
  }
  if (command === "write memory") {
    state.startup = saveStartupSnapshot(state);
    output = ["Building configuration...", "[OK]"];
  } else if (command === "copy startup-config running-config") {
    if (!state.startup) output = ["% Copy stopped: startup-config is not present."];
    else {
      state.interfaceState = cloneInterface(state.startup.interfaceState);
      state.defaultRoute = state.startup.defaultRoute;
      output = ["Startup configuration merged into the bounded IPv4 running state."];
    }
  } else if (command === "configure replace nvram:startup-config force") {
    if (!state.startup) output = ["% Configuration replace stopped: no saved startup checkpoint exists."];
    else {
      state.recoveryCheckpoint = scenarioCheckpoint(state);
      state.interfaceState = cloneInterface(state.startup.interfaceState);
      state.defaultRoute = state.startup.defaultRoute;
      state.mode = "privileged";
      state.selectedInterface = null;
      output = [
        "Running configuration replaced from startup-config.",
        "Recovery checkpoint created for the previous bounded IPv4 state.",
      ];
    }
  }
  return { state, output: [...output, ...commandOutput(state, event)] };
};

const expectedParse = (
  state: Ipv4ScenarioState,
  action: ExpectedAction,
): Extract<RegistryParseResult, { status: "valid" }> | null => {
  if (!action.command) return null;
  const parsed = parseRegistryInput(registryFor(state), action.command, action.context);
  return parsed.status === "valid" ? parsed : null;
};

const eventsEqual = (
  actual: ParsedCommandEvent,
  expected: ParsedCommandEvent,
): boolean => actual.usedDo === expected.usedDo
  && lower(actual.canonicalInput) === lower(expected.canonicalInput);

const acceptedResult = (
  state: Ipv4ScenarioState,
  output: string[],
  action: ExpectedAction,
  category: Ipv4ScenarioFeedbackCategory = "objective-complete",
): Ipv4ScenarioActionResult => ({
  accepted: true,
  valid: true,
  state,
  output,
  explanation: action.reason,
  useCase: action.useCase,
  verification: action.verify,
  rollback: action.rollback,
  example: action.command || "Press Enter to accept the displayed destination.",
  nextObjective: getIpv4ScenarioObjective(state),
  category,
});

const rejectedResult = (
  state: Ipv4ScenarioState,
  explanation: string,
  errorCode: Ipv4ScenarioErrorCode,
  output: string[] = [],
  valid = false,
  displayInput?: string,
): Ipv4ScenarioActionResult => {
  const action = expectedAction(state);
  return {
    accepted: false,
    valid,
    state: cloneState(state),
    output,
    explanation,
    useCase: action?.useCase ?? "Review the completed lab or restart with another deterministic seed.",
    verification: action?.verify ?? "The complete report contains the final verified state.",
    rollback: valid
      ? "A valid exploratory configuration command affects simulated running state; use its targeted no form or corrective command if needed."
      : "Rejected input did not change simulated state, so no rollback is required.",
    ...(action?.command ? { example: action.command } : {}),
    nextObjective: getIpv4ScenarioObjective(state),
    category: valid ? "valid-unrelated" : state.phase === "complete" ? "complete" : "rejected",
    errorCode,
    ...(displayInput === undefined ? {} : { displayInput }),
  };
};

const progressAfterAction = (state: Ipv4ScenarioState): void => {
  const next: Partial<Record<Ipv4ScenarioPhase, Ipv4ScenarioPhase>> = {
    "gain-privilege": "baseline-interface",
    "baseline-interface": "inspect-running-interface",
    "inspect-running-interface": "enter-global",
    "enter-global": "select-interface",
    "select-interface": "configure-description",
    "configure-description": "configure-address",
    "configure-address": "enable-interface",
    "enable-interface": "return-to-exec",
    "return-to-exec": "verify-interface",
    "verify-interface": "verify-connected-routes",
    "verify-connected-routes": "test-local-peer",
    "test-local-peer": "test-remote-before-route",
    "test-remote-before-route": "inspect-routing-table",
    "enter-route-configuration": "install-default-route",
    "install-default-route": "verify-default-route",
    "verify-default-route": "verify-remote-success",
    "verify-remote-success": "remove-default-route",
    "remove-default-route": "verify-remote-failure",
    "verify-remote-failure": "recover-default-route",
    "recover-default-route": "verify-recovered-route",
    "verify-recovered-route": "verify-recovered-remote",
    "verify-recovered-remote": "exit-recovery-configuration",
    "exit-recovery-configuration": "begin-save",
  };
  state.acceptedActions += 1;
  state.phase = next[state.phase] ?? state.phase;
  state.subActionIndex = 0;
};

const parseFailure = (
  state: Ipv4ScenarioState,
  parsed: Exclude<RegistryParseResult, { status: "valid" }>,
  displayInput: string,
): Ipv4ScenarioActionResult => {
  switch (parsed.status) {
    case "wrong-context": return rejectedResult(state, parsed.message, "WRONG_MODE", [], false, displayInput);
    case "ambiguous": return rejectedResult(state, "The abbreviation is ambiguous in this prompt. Type another character or press ? for the available branch.", "AMBIGUOUS", [], false, displayInput);
    case "incomplete": return rejectedResult(state, parsed.message, "INCOMPLETE", [], false, displayInput);
    case "invalid": {
      const input = parsed.input;
      const code = input.length > 256 ? "TOO_LONG"
        : !input ? "EMPTY"
          : /^ip address\s+/iu.test(input) && input.split(/\s+/u).some((part) => ipv4Pattern.test(part) && !isIpv4(part)) ? "INVALID_IPV4"
            : /^ip address\s+/iu.test(input) && input.split(/\s+/u).length >= 4 ? "INVALID_MASK"
              : "UNSUPPORTED";
      return rejectedResult(state, parsed.message, code, parsed.message.split("\n"), false, displayInput);
    }
  }
};

const beginPendingInteraction = (
  current: Ipv4ScenarioState,
  event: ParsedCommandEvent,
): { state: Ipv4ScenarioState; output: string[] } | null => {
  const command = lower(event.canonicalInput);
  let pending: Exclude<Ipv4ScenarioPendingConfirmation, null> | null = null;
  let pendingInterface: string | null = null;
  let output: string[] = [];
  if (command === "copy running-config startup-config") {
    pending = "save-startup";
    output = ["Destination filename [startup-config]?"];
  } else if (command === "reload") {
    pending = "reload";
    output = ["Proceed with reload? [confirm]"];
  } else if (command === "erase startup-config") {
    pending = "erase-startup";
    output = ["Erasing startup configuration removes the saved recovery point. Continue? [confirm]"];
  } else if (command.startsWith("default interface ")) {
    pending = "default-interface";
    pendingInterface = event.normalisedArguments.interface
      ?? event.canonicalInput.replace(/^default interface /iu, "");
    output = [`Defaulting ${pendingInterface} removes all settings in that interface scope. Continue? [confirm]`];
  }
  if (!pending) return null;
  const state = cloneState(current);
  state.pendingConfirmation = pending;
  state.pendingInterface = pendingInterface;
  state.pendingConfirmationAdvances = false;
  if (pending !== "save-startup") state.recoveryCheckpoint = scenarioCheckpoint(state);
  return { state, output };
};

const finishConfirmation = (state: Ipv4ScenarioState, raw: string): Ipv4ScenarioActionResult => {
  const action = expectedAction(state);
  if (!action) return rejectedResult(state, "No confirmation is expected.", "WRONG_STEP");
  const pending = state.pendingConfirmation;
  if (!pending) return rejectedResult(state, "No confirmation is expected.", "WRONG_STEP");
  const answer = raw.trim().toLocaleLowerCase("en-GB");
  if (pending === "save-startup" && answer && answer !== "startup-config") {
    return rejectedResult(
      state,
      "Press Enter to accept the displayed startup-config destination, or type startup-config exactly.",
      "WRONG_VALUE",
      ["% Use startup-config, or press Enter to accept the default."],
    );
  }
  const next = cloneState(state);
  const advances = next.pendingConfirmationAdvances;
  if (pending !== "save-startup" && answer && !["confirm", "yes", "y"].includes(answer)) {
    next.pendingConfirmation = null;
    next.pendingInterface = null;
    next.pendingConfirmationAdvances = false;
    const result = rejectedResult(
      next,
      "Confirmation declined; no simulated device state changed and the learning task did not advance.",
      "VALID_UNRELATED",
      ["% Confirmation declined; no state changed."],
      true,
    );
    result.category = "valid-unrelated";
    result.rollback = "No rollback is required because the pending broad operation was declined.";
    return result;
  }

  next.pendingConfirmation = null;
  next.pendingInterface = null;
  next.pendingConfirmationAdvances = false;
  let output: string[];
  if (pending === "save-startup") {
    next.startup = saveStartupSnapshot(next);
    output = ["Building configuration...", "[OK]"];
    if (advances) {
      next.startup.savedAtAction = 26;
      next.subActionIndex = 0;
      next.acceptedActions = 26;
      next.phase = "complete";
      return acceptedResult(next, output, action);
    }
  } else if (pending === "erase-startup") {
    next.startup = null;
    output = ["[OK] startup-config erased", "Simulator recovery checkpoint retained."];
  } else if (pending === "reload") {
    if (!next.startup) {
      output = ["% Reload cancelled: no saved recovery configuration exists."];
    } else {
      next.interfaceState = cloneInterface(next.startup.interfaceState);
      next.defaultRoute = next.startup.defaultRoute;
      next.mode = "user";
      next.selectedInterface = null;
      output = ["System configuration restored from startup-config.", "Simulator recovery checkpoint retained."];
    }
  } else {
    const target = state.pendingInterface;
    const reset = (item: Ipv4InterfaceState): Ipv4InterfaceState => ({
      description: "",
      address: null,
      mask: null,
      adminUp: false,
      physicalUp: item.physicalUp,
    });
    if (target === next.parameters.interfaceCanonical) next.interfaceState = reset(next.interfaceState);
    else if (target === next.parameters.wanInterfaceCanonical) next.wanInterfaceState = reset(next.wanInterfaceState);
    output = target === next.parameters.interfaceCanonical || target === next.parameters.wanInterfaceCanonical
      ? [`Interface ${target} reset to profile defaults.`, "Simulator recovery checkpoint retained."]
      : [`Interface ${target} is outside this bounded topology; no represented interface state changed.`, "Simulator recovery checkpoint retained."];
  }

  const result = rejectedResult(
    next,
    `The confirmed ${pending.replaceAll("-", " ")} operation changed only simulated device state; it did not complete this learning task.`,
    "VALID_UNRELATED",
    output,
    true,
  );
  result.category = "valid-unrelated";
  result.rollback = next.recoveryCheckpoint
    ? "Use Restore checkpoint to recover the state captured immediately before this broad operation."
    : "The save operation changed only the simulated startup snapshot; continue with the current task.";
  return result;
};

export const runIpv4ScenarioCommand = (
  current: Ipv4ScenarioState,
  raw: string,
): Ipv4ScenarioActionResult => {
  const restored = restoreIpv4ScenarioState(current);
  if (!restored) throw new Error("Invalid IPv4 scenario state");
  const state = cloneState(restored);
  if (state.phase === "complete") return rejectedResult(state, "This IPv4 lab is already complete.", "SCENARIO_COMPLETE");
  if (state.phase === "diagnose-routing-fault") {
    return rejectedResult(state, "Interpret the displayed route table before entering another command.", "INTERPRETATION_REQUIRED");
  }
  if (state.pendingConfirmation) return finishConfirmation(state, raw);
  if (!raw.trim()) return rejectedResult(state, "Enter a command at the current prompt.", "EMPTY");
  if (raw.length > 256) return rejectedResult(state, "The simulator accepts at most 256 characters.", "TOO_LONG");

  const registry = registryFor(state);
  const displayInput = redactRegistryInput(registry, raw, state.mode);
  const parsed = parseRegistryInput(registry, raw, state.mode);
  if (parsed.status !== "valid") return parseFailure(state, parsed, displayInput);
  const action = expectedAction(state);
  if (!action) return rejectedResult(state, "No command objective is available.", "WRONG_STEP");
  const expected = expectedParse(state, action);
  const pendingStart = beginPendingInteraction(state, parsed.event);
  if (pendingStart) {
    const matchesCurrent = Boolean(expected && eventsEqual(parsed.event, expected.event));
    if (matchesCurrent && state.phase === "begin-save"
      && pendingStart.state.pendingConfirmation === "save-startup") {
      pendingStart.state.pendingConfirmationAdvances = true;
      pendingStart.state.phase = "confirm-save";
      pendingStart.state.acceptedActions = 25;
      pendingStart.state.subActionIndex = 0;
      const result = acceptedResult(pendingStart.state, pendingStart.output, action, "awaiting-confirmation");
      result.awaitingConfirmation = true;
      result.errorCode = "AWAITING_CONFIRMATION";
      return result;
    }
    const result = rejectedResult(
      pendingStart.state,
      "This valid exploratory command is waiting for confirmation. Confirm or decline it before entering another IOS command; it does not advance the current learning task.",
      "VALID_UNRELATED",
      pendingStart.output,
      true,
      displayInput,
    );
    result.state = pendingStart.state;
    result.category = "awaiting-confirmation";
    result.awaitingConfirmation = true;
    result.rollback = pendingStart.state.recoveryCheckpoint
      ? "Decline the prompt to leave state unchanged, or use Restore checkpoint after confirming the broad operation."
      : "Startup state has not changed while the save destination confirmation is pending.";
    return result;
  }
  const applied = applyEvent(state, parsed.event);

  if (!expected || !eventsEqual(parsed.event, expected.event)) {
    const result = rejectedResult(
      applied.state,
      "Valid command, but it does not complete this operational objective. Its supported state or output effect was applied without a lab penalty.",
      "VALID_UNRELATED",
      applied.output,
      true,
      displayInput,
    );
    result.state = applied.state;
    result.nextObjective = getIpv4ScenarioObjective(applied.state);
    return result;
  }

  const next = applied.state;
  if (state.phase === "inspect-routing-table") {
    next.phase = "diagnose-routing-fault";
    return acceptedResult(next, applied.output, action, "awaiting-interpretation");
  }
  progressAfterAction(next);
  return acceptedResult(next, applied.output, action);
};

/**
 * Restore the one-use checkpoint created before a broad simulated operation.
 * Lesson progress is intentionally preserved and no mastery credit is earned.
 */
export const restoreIpv4ScenarioCheckpoint = (
  current: Ipv4ScenarioState,
): Ipv4ScenarioActionResult => {
  const restored = restoreIpv4ScenarioState(current);
  if (!restored) throw new Error("Invalid IPv4 scenario state");
  if (!restored.recoveryCheckpoint) {
    return rejectedResult(
      restored,
      "No IPv4 recovery checkpoint is available.",
      "WRONG_STEP",
      ["% No recovery checkpoint is available."],
    );
  }
  const next = cloneState(restored);
  applyScenarioCheckpoint(next, restored.recoveryCheckpoint);
  next.pendingConfirmation = null;
  next.pendingInterface = null;
  next.pendingConfirmationAdvances = false;
  next.recoveryCheckpoint = null;
  const result = rejectedResult(
    next,
    "The previous bounded IPv4 running state was restored. The twenty-six-step learning position was preserved and did not advance.",
    "VALID_UNRELATED",
    ["Previous IPv4 running state restored from the simulator recovery checkpoint."],
    true,
  );
  result.state = next;
  result.category = "valid-unrelated";
  result.rollback = "The one-use checkpoint has been consumed; verify the restored state before continuing.";
  return result;
};

/** Cancel an interactive prompt (for example Ctrl+C) without applying it. */
export const cancelIpv4ScenarioPendingInteraction = (
  current: Ipv4ScenarioState,
): Ipv4ScenarioActionResult => {
  const restored = restoreIpv4ScenarioState(current);
  if (!restored) throw new Error("Invalid IPv4 scenario state");
  if (!restored.pendingConfirmation) {
    return rejectedResult(restored, "No interactive operation is pending.", "WRONG_STEP");
  }
  const next = cloneState(restored);
  next.pendingConfirmation = null;
  next.pendingInterface = null;
  next.pendingConfirmationAdvances = false;
  // If the cancelled operation was the lab's final save, return to its command
  // action so the learner can start the copy again.
  if (next.phase === "confirm-save") {
    next.phase = "begin-save";
    next.acceptedActions = 24;
  }
  const result = rejectedResult(
    next,
    "The interactive operation was cancelled without changing simulated device state or advancing the learning task.",
    "VALID_UNRELATED",
    ["% Operation interrupted; no pending change was applied."],
    true,
  );
  result.state = next;
  result.category = "valid-unrelated";
  result.rollback = "No rollback is required because the pending operation was not applied.";
  return result;
};

export const submitIpv4ScenarioInterpretation = (
  current: Ipv4ScenarioState,
  choice: Ipv4ScenarioChoiceId,
): Ipv4ScenarioActionResult => {
  const restored = restoreIpv4ScenarioState(current);
  if (!restored) throw new Error("Invalid IPv4 scenario state");
  const state = cloneState(restored);
  if (state.phase !== "diagnose-routing-fault") {
    return rejectedResult(state, "The current objective requires a command, not an interpretation.", "COMMAND_REQUIRED");
  }
  if (choice !== "missing-default-route") {
    return rejectedResult(
      state,
      "That conclusion is not supported by the output. A numeric-address ping bypasses DNS, and the route table cannot prove remote host power state. Read the gateway-of-last-resort line again.",
      "WRONG_INTERPRETATION",
    );
  }
  state.acceptedActions = 14;
  state.phase = "enter-route-configuration";
  state.subActionIndex = 0;
  return {
    accepted: true,
    valid: true,
    state,
    output: ["Diagnosis accepted: the connected/local routes are healthy, but no default route exists for the remote destination."],
    explanation: "The failed remote ping and “Gateway of last resort is not set” line converge on the same missing-path cause. Connected routes cover only their own subnets.",
    useCase: "Evidence-led diagnosis prevents unrelated changes to a healthy interface or DNS service.",
    verification: `The repair must install and then display S* 0.0.0.0/0 via ${state.parameters.gateway}.`,
    rollback: "The interpretation changed no device state; any later static route can be removed with its exact no form.",
    nextObjective: getIpv4ScenarioObjective(state),
    category: "objective-complete",
  };
};
