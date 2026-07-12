/**
 * A deterministic, local-only IOS XE learning lab.
 *
 * Player input is parsed as inert text. It is never passed to a shell, an
 * evaluator, a device, or any other execution environment.
 */

export type Ipv4ScenarioMode = "user" | "privileged" | "global" | "interface";

export type Ipv4ScenarioFault = "missing-default-route" | "wrong-default-next-hop";

export type Ipv4ScenarioPhase =
  | "gain-privilege"
  | "enter-global"
  | "select-interface"
  | "configure-address"
  | "enable-interface"
  | "return-to-exec"
  | "inspect-interface"
  | "interpret-interface"
  | "test-initial-reachability"
  | "inspect-routing-table"
  | "diagnose-routing-fault"
  | "repair-enter-global"
  | "remove-faulty-route"
  | "add-default-route"
  | "repair-return-to-exec"
  | "retest-reachability"
  | "save-working-config"
  | "rollback-enter-global"
  | "rollback-remove-route"
  | "rollback-select-interface"
  | "rollback-disable-interface"
  | "rollback-remove-address"
  | "rollback-return-to-exec"
  | "rollback-inspect-interface"
  | "interpret-rollback"
  | "rollback-inspect-routing-table"
  | "save-rollback"
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
  interfaceName: string;
  localAddress: string;
  subnetMask: string;
  prefixLength: number;
  networkAddress: string;
  gateway: string;
  wrongGateway: string;
  remoteTarget: string;
}

export interface Ipv4InterfaceState {
  address: string | null;
  mask: string | null;
  adminUp: boolean;
}

export interface Ipv4StartupSnapshot {
  interfaceState: Ipv4InterfaceState;
  defaultRoute: string | null;
  configuration: string;
}

export interface Ipv4ScenarioState {
  seed: number;
  hostname: "R1";
  mode: Ipv4ScenarioMode;
  phase: Ipv4ScenarioPhase;
  parameters: Ipv4ScenarioParameters;
  fault: Ipv4ScenarioFault;
  selectedInterface: string | null;
  interfaceState: Ipv4InterfaceState;
  defaultRoute: string | null;
  startup: Ipv4StartupSnapshot | null;
  acceptedActions: number;
}

export type Ipv4ScenarioErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "UNSUPPORTED"
  | "WRONG_MODE"
  | "WRONG_STEP"
  | "INVALID_SYNTAX"
  | "INVALID_IPV4"
  | "INVALID_MASK"
  | "WRONG_VALUE"
  | "INTERPRETATION_REQUIRED"
  | "COMMAND_REQUIRED"
  | "WRONG_INTERPRETATION"
  | "SCENARIO_COMPLETE";

export interface Ipv4ScenarioActionResult {
  accepted: boolean;
  state: Ipv4ScenarioState;
  output: string[];
  explanation: string;
  useCase: string;
  verification: string;
  rollback: string;
  example?: string;
  nextObjective: string;
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
}

const variants: Ipv4ScenarioParameters[] = [
  {
    interfaceName: "gi0/0/1",
    localAddress: "192.168.10.1",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    networkAddress: "192.168.10.0",
    gateway: "192.168.10.254",
    wrongGateway: "192.168.10.253",
    remoteTarget: "1.1.1.1",
  },
  {
    interfaceName: "fa0/0/1",
    localAddress: "192.168.20.1",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    networkAddress: "192.168.20.0",
    gateway: "192.168.20.254",
    wrongGateway: "192.168.20.253",
    remoteTarget: "8.8.8.8",
  },
  {
    interfaceName: "te0/1/1",
    localAddress: "10.10.10.1",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    networkAddress: "10.10.10.0",
    gateway: "10.10.10.254",
    wrongGateway: "10.10.10.253",
    remoteTarget: "9.9.9.9",
  },
];

const normaliseSeed = (seed: number) => {
  if (!Number.isFinite(seed)) return 1;
  return (Math.trunc(seed) >>> 0) || 1;
};

const nextSeed = (seed: number) => (Math.imul(seed, 1664525) + 1013904223) >>> 0;

export const createIpv4Scenario = (seed = 1): Ipv4ScenarioState => {
  const stableSeed = normaliseSeed(seed);
  const random = nextSeed(stableSeed);
  const parameters = variants[random % variants.length];
  const fault: Ipv4ScenarioFault = ((random >>> 8) & 1) === 0
    ? "missing-default-route"
    : "wrong-default-next-hop";

  return {
    seed: stableSeed,
    hostname: "R1",
    mode: "user",
    phase: "gain-privilege",
    parameters: { ...parameters },
    fault,
    selectedInterface: null,
    interfaceState: { address: null, mask: null, adminUp: false },
    defaultRoute: fault === "wrong-default-next-hop" ? parameters.wrongGateway : null,
    startup: null,
    acceptedActions: 0,
  };
};

const scenarioModes = new Set<Ipv4ScenarioMode>(["user", "privileged", "global", "interface"]);
const scenarioPhases = new Set<Ipv4ScenarioPhase>([
  "gain-privilege", "enter-global", "select-interface", "configure-address",
  "enable-interface", "return-to-exec", "inspect-interface", "interpret-interface",
  "test-initial-reachability", "inspect-routing-table", "diagnose-routing-fault",
  "repair-enter-global", "remove-faulty-route", "add-default-route",
  "repair-return-to-exec", "retest-reachability", "save-working-config",
  "rollback-enter-global", "rollback-remove-route", "rollback-select-interface",
  "rollback-disable-interface", "rollback-remove-address", "rollback-return-to-exec",
  "rollback-inspect-interface", "interpret-rollback", "rollback-inspect-routing-table",
  "save-rollback", "complete",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const restoreInterfaceState = (
  value: unknown,
  parameters: Ipv4ScenarioParameters,
): Ipv4InterfaceState | null => {
  if (!isRecord(value) || typeof value.adminUp !== "boolean") return null;
  const address = value.address;
  const mask = value.mask;
  const addressValid = address === null || address === parameters.localAddress;
  const maskValid = mask === null || mask === parameters.subnetMask;
  if (!addressValid || !maskValid || (address === null) !== (mask === null)) return null;
  return { address: address as string | null, mask: mask as string | null, adminUp: value.adminUp };
};

export const restoreIpv4ScenarioState = (value: unknown): Ipv4ScenarioState | null => {
  if (!isRecord(value) || typeof value.seed !== "number") return null;
  const baseline = createIpv4Scenario(value.seed);
  if (value.hostname !== "R1" || !scenarioModes.has(value.mode as Ipv4ScenarioMode)) return null;
  if (!scenarioPhases.has(value.phase as Ipv4ScenarioPhase)) return null;
  if (!isRecord(value.parameters)
    || JSON.stringify(value.parameters) !== JSON.stringify(baseline.parameters)
    || value.fault !== baseline.fault) return null;
  if (value.selectedInterface !== null && value.selectedInterface !== baseline.parameters.interfaceName) return null;
  const interfaceState = restoreInterfaceState(value.interfaceState, baseline.parameters);
  if (!interfaceState) return null;
  const allowedRoutes = new Set<unknown>([null, baseline.parameters.gateway, baseline.parameters.wrongGateway]);
  if (!allowedRoutes.has(value.defaultRoute)) return null;
  if (!Number.isInteger(value.acceptedActions) || (value.acceptedActions as number) < 0 || (value.acceptedActions as number) > 40) return null;

  let startup: Ipv4StartupSnapshot | null = null;
  if (value.startup !== null) {
    if (!isRecord(value.startup)
      || typeof value.startup.configuration !== "string"
      || value.startup.configuration.length > 2_048
      || !allowedRoutes.has(value.startup.defaultRoute)) return null;
    const startupInterface = restoreInterfaceState(value.startup.interfaceState, baseline.parameters);
    if (!startupInterface) return null;
    startup = {
      interfaceState: startupInterface,
      defaultRoute: value.startup.defaultRoute as string | null,
      configuration: value.startup.configuration,
    };
  }

  return {
    seed: baseline.seed,
    hostname: "R1",
    mode: value.mode as Ipv4ScenarioMode,
    phase: value.phase as Ipv4ScenarioPhase,
    parameters: { ...baseline.parameters },
    fault: baseline.fault,
    selectedInterface: value.selectedInterface as string | null,
    interfaceState,
    defaultRoute: value.defaultRoute as string | null,
    startup,
    acceptedActions: value.acceptedActions as number,
  };
};

const cloneState = (state: Ipv4ScenarioState): Ipv4ScenarioState => ({
  ...state,
  parameters: { ...state.parameters },
  interfaceState: { ...state.interfaceState },
  startup: state.startup
    ? {
        ...state.startup,
        interfaceState: { ...state.startup.interfaceState },
      }
    : null,
});

export const ipv4ScenarioPrompt = (state: Ipv4ScenarioState) => {
  switch (state.mode) {
    case "user": return `${state.hostname}>`;
    case "privileged": return `${state.hostname}#`;
    case "global": return `${state.hostname}(config)#`;
    case "interface": return `${state.hostname}(config-if)#`;
  }
};

const objectives: Record<Ipv4ScenarioPhase, (state: Ipv4ScenarioState) => string> = {
  "gain-privilege": () => "Reach privileged EXEC mode from the current User EXEC prompt.",
  "enter-global": () => "Enter the mode used to change the running configuration.",
  "select-interface": state => `Open configuration context for the branch LAN interface ${state.parameters.interfaceName}.`,
  "configure-address": state => `Assign ${state.parameters.localAddress} with subnet mask ${state.parameters.subnetMask} to the selected interface.`,
  "enable-interface": () => "Administratively enable the selected interface.",
  "return-to-exec": () => "Return to privileged EXEC mode so that you can verify the change.",
  "inspect-interface": () => "Display the concise IPv4 address, Status and Protocol summary for all interfaces.",
  "interpret-interface": () => "Interpret the branch interface's Status and Protocol columns before continuing.",
  "test-initial-reachability": state => `Test IPv4 reachability to the remote service at ${state.parameters.remoteTarget}.`,
  "inspect-routing-table": () => "Inspect the IPv4 routing table to find why the remote network is unreachable.",
  "diagnose-routing-fault": () => "Choose the routing-table diagnosis that best explains the failed reachability test.",
  "repair-enter-global": () => "Enter the mode used to repair the routing configuration.",
  "remove-faulty-route": () => "Remove the incorrect gateway of last resort without disturbing the connected route.",
  "add-default-route": state => `Install a gateway of last resort through the branch gateway ${state.parameters.gateway}.`,
  "repair-return-to-exec": () => "Return to privileged EXEC mode to verify the repair.",
  "retest-reachability": state => `Repeat the reachability test to ${state.parameters.remoteTarget}.`,
  "save-working-config": () => "Persist the verified running configuration as the startup configuration.",
  "rollback-enter-global": () => "Enter configuration mode to practise a controlled rollback of this lab.",
  "rollback-remove-route": () => "Remove the gateway of last resort added during the repair.",
  "rollback-select-interface": state => `Open ${state.parameters.interfaceName} so its lab configuration can be removed.`,
  "rollback-disable-interface": () => "Return the interface to its original administratively disabled state.",
  "rollback-remove-address": () => "Remove the IPv4 address and subnet mask from the selected interface.",
  "rollback-return-to-exec": () => "Return to privileged EXEC mode and verify the rollback.",
  "rollback-inspect-interface": () => "Display the concise interface summary to confirm the rollback state.",
  "interpret-rollback": () => "Interpret the interface summary and decide whether the interface rollback is complete.",
  "rollback-inspect-routing-table": () => "Inspect the IPv4 routing table to confirm that the lab's gateway of last resort was removed.",
  "save-rollback": () => "Persist the verified rollback so the startup and running configurations agree.",
  "complete": () => "Lab complete: configuration, diagnosis, verification, persistence and rollback have all been demonstrated.",
};

export const getIpv4ScenarioObjective = (state: Ipv4ScenarioState) => objectives[state.phase](state);

export const getIpv4ScenarioChoices = (state: Ipv4ScenarioState): Ipv4ScenarioChoice[] => {
  switch (state.phase) {
    case "interpret-interface":
      return [
        { id: "interface-operational", label: "The interface and line protocol are operational." },
        { id: "interface-administratively-down", label: "The interface is disabled by configuration." },
        { id: "interface-physical-fault", label: "The interface is enabled but the physical or data-link layer is down." },
        { id: "interface-address-missing", label: "The interface is operational but has no IPv4 address." },
      ];
    case "diagnose-routing-fault":
      return [
        { id: "missing-default-route", label: "No gateway of last resort is installed." },
        { id: "wrong-default-next-hop", label: "The default route points to the wrong next hop." },
        { id: "remote-host-fault", label: "The routing table proves that the remote host is powered off." },
        { id: "dns-fault", label: "Name resolution is preventing this address-based test." },
      ];
    case "interpret-rollback":
      return [
        { id: "rollback-complete", label: "The address is unassigned and the interface is administratively down." },
        { id: "rollback-incomplete-address", label: "The address remains configured." },
        { id: "rollback-incomplete-state", label: "The interface remains operational." },
      ];
    default:
      return [];
  }
};

const commandExampleForPhase = (state: Ipv4ScenarioState): string | null => {
  const p = state.parameters;
  switch (state.phase) {
    case "gain-privilege": return "enable";
    case "enter-global":
    case "repair-enter-global":
    case "rollback-enter-global": return "configure terminal";
    case "select-interface":
    case "rollback-select-interface": return `interface ${p.interfaceName}`;
    case "configure-address": return `ip address ${p.localAddress} ${p.subnetMask}`;
    case "enable-interface": return "no shutdown";
    case "return-to-exec":
    case "repair-return-to-exec":
    case "rollback-return-to-exec": return "end";
    case "inspect-interface":
    case "rollback-inspect-interface": return "show ip interface brief";
    case "test-initial-reachability":
    case "retest-reachability": return `ping ${p.remoteTarget}`;
    case "inspect-routing-table":
    case "rollback-inspect-routing-table": return "show ip route";
    case "remove-faulty-route": return `no ip route 0.0.0.0 0.0.0.0 ${p.wrongGateway}`;
    case "add-default-route": return `ip route 0.0.0.0 0.0.0.0 ${p.gateway}`;
    case "save-working-config":
    case "save-rollback": return "copy running-config startup-config";
    case "rollback-remove-route": return `no ip route 0.0.0.0 0.0.0.0 ${p.gateway}`;
    case "rollback-disable-interface": return "shutdown";
    case "rollback-remove-address": return "no ip address";
    default: return null;
  }
};

export const getIpv4ScenarioHint = (
  state: Ipv4ScenarioState,
  level: 1 | 2,
): Ipv4ScenarioHint => {
  const example = commandExampleForPhase(state);
  const prompt = ipv4ScenarioPrompt(state);
  const interpretation = getIpv4ScenarioChoices(state).length > 0;

  if (state.phase === "interpret-interface") {
    return {
      heading: level === 1 ? "Read the row as three separate facts" : "Correlate address, Status and Protocol",
      explanation: level === 1
        ? "An address proves Layer 3 configuration, Status reflects administrative or physical state, and Protocol reflects the line protocol. Do not infer the whole result from one column."
        : `The target row should contain ${state.parameters.localAddress} and show up in both the Status and Protocol columns. Together, those facts prove the local interface is operational.`,
      example: null,
      visualFocus: "interface",
    };
  }
  if (state.phase === "diagnose-routing-fault") {
    return {
      heading: level === 1 ? "Follow the evidence from local to remote" : "Inspect the gateway of last resort",
      explanation: level === 1
        ? "The interface is already healthy and the address-based ping failed, so DNS is irrelevant. Compare the connected LAN and default route with the work order."
        : state.fault === "missing-default-route"
          ? "The connected branch LAN is present, but the output says the gateway of last resort is not set. Remote prefixes therefore have no matching path."
          : `A candidate default exists, but it points to ${state.parameters.wrongGateway} instead of the documented gateway ${state.parameters.gateway}.`,
      example: null,
      visualFocus: "route",
    };
  }
  if (state.phase === "interpret-rollback") {
    return {
      heading: level === 1 ? "Prove both parts of the rollback" : "Look for the original interface state",
      explanation: level === 1
        ? "A complete rollback must remove the Layer 3 address and restore the administrative shutdown state. Check both, not just one."
        : "The row should say unassigned and administratively down. Protocol down then agrees with the disabled interface state.",
      example: null,
      visualFocus: "interface",
    };
  }

  if (state.phase === "remove-faulty-route") {
    return {
      heading: level === 1 ? "Remove the exact bad static route, not the connected network" : "Read the removal command from left to right",
      explanation: level === 1
        ? `The routing table showed a default route through ${state.parameters.wrongGateway}. In IOS configuration, no before a complete command removes that exact configuration statement. The connected ${state.parameters.networkAddress}/${state.parameters.prefixLength} route comes from the interface address, so removing a separate 0.0.0.0/0 static route cannot delete it.`
        : `This command exactly mirrors the incorrect static route and prefixes it with no. The two 0.0.0.0 values mean destination 0.0.0.0 with mask 0.0.0.0—prefix /0—which matches any destination only when no more-specific route exists. ${state.parameters.wrongGateway} identifies the incorrect next hop to remove.`,
      example: level === 2 ? example : null,
      breakdown: level === 2 ? [
        { token: "no", meaning: "Remove the matching configuration statement" },
        { token: "ip route", meaning: "The static IPv4 route feature" },
        { token: "0.0.0.0", meaning: "Destination network: all-zero default" },
        { token: "0.0.0.0", meaning: "Mask: /0, so it is the least-specific route" },
        { token: state.parameters.wrongGateway, meaning: "The exact incorrect next hop shown in the routing table" },
      ] : undefined,
      visualFocus: "route",
    };
  }

  if (state.phase === "add-default-route") {
    return {
      heading: level === 1 ? "Build a least-specific route towards the documented gateway" : "Read the default route from left to right",
      explanation: level === 1
        ? `A default route is used only when the routing table has no more-specific match. Keep the connected ${state.parameters.networkAddress}/${state.parameters.prefixLength} route; add a separate 0.0.0.0/0 path through ${state.parameters.gateway}.`
        : `The first 0.0.0.0 is the destination and the second is its mask. Together they represent /0, the gateway of last resort. The final value is the documented next hop on the directly connected LAN.`,
      example: level === 2 ? example : null,
      breakdown: level === 2 ? [
        { token: "ip route", meaning: "Create a static IPv4 route" },
        { token: "0.0.0.0", meaning: "Destination network: all-zero default" },
        { token: "0.0.0.0", meaning: "Mask: /0, matching otherwise-unknown destinations" },
        { token: state.parameters.gateway, meaning: "Next hop supplied by the work order" },
      ] : undefined,
      visualFocus: "route",
    };
  }

  const navigation = ["gain-privilege", "enter-global", "repair-enter-global", "rollback-enter-global", "select-interface", "rollback-select-interface", "return-to-exec", "repair-return-to-exec", "rollback-return-to-exec"].includes(state.phase);
  const route = ["inspect-routing-table", "remove-faulty-route", "add-default-route", "rollback-remove-route", "rollback-inspect-routing-table"].includes(state.phase);
  const save = ["save-working-config", "save-rollback"].includes(state.phase);
  const verification = ["inspect-interface", "test-initial-reachability", "retest-reachability", "rollback-inspect-interface"].includes(state.phase);

  return {
    heading: level === 1 ? "Use the prompt as your location marker" : "A worked command for this exact work order",
    explanation: level === 1
      ? navigation
        ? `You are at ${prompt}. First identify the destination CLI context, then choose the command family that moves from the current prompt towards it.`
        : route
          ? "Treat the routing table as a forwarding decision: destination and mask select traffic, while the next hop says where unmatched traffic leaves."
          : save
            ? "Verification proves the running state. Saving is a separate action that copies that verified state into startup storage."
            : verification
              ? "Use a read-only command that directly measures the condition named in the objective, then interpret its output before changing anything else."
              : "Work from feature → action → documented values. The prompt confirms the scope; the work order supplies the interface or IPv4 values."
      : example
        ? `At ${prompt}, the complete command for the current seeded values is shown below. Type it yourself or use Tab to practise IOS completion.`
        : interpretation
          ? "Choose the conclusion supported by all displayed evidence, not the most familiar fault."
          : "The lab is complete; review the report or restart with a new seeded work order.",
    example: level === 2 ? example : null,
    visualFocus: navigation ? "prompt" : route ? "route" : save ? "save" : verification ? "verification" : "interface",
  };
};

type ParsedCommand =
  | { kind: "enable" }
  | { kind: "configure-terminal" }
  | { kind: "interface"; interfaceName: string }
  | { kind: "ip-address"; address: string; mask: string }
  | { kind: "no-shutdown" }
  | { kind: "shutdown" }
  | { kind: "no-ip-address" }
  | { kind: "exit" }
  | { kind: "end" }
  | { kind: "show-ip-interface-brief" }
  | { kind: "ping"; target: string }
  | { kind: "show-ip-route" }
  | { kind: "default-route"; nextHop: string }
  | { kind: "remove-default-route"; nextHop: string }
  | { kind: "save" };

type ParseResult = { command: ParsedCommand } | { errorCode: Ipv4ScenarioErrorCode; message: string };

const normalise = (input: string) => input.trim().replace(/\s+/g, " ");
interface ScenarioGrammarCandidate {
  canonical: string;
  argumentIndexes: ReadonlySet<number>;
}

const grammarCandidate = (canonical: string, ...argumentIndexes: number[]): ScenarioGrammarCandidate => ({
  canonical,
  argumentIndexes: new Set(argumentIndexes),
});

const scenarioGrammar = (state: Ipv4ScenarioState): ScenarioGrammarCandidate[] => {
  const p = state.parameters;
  switch (state.mode) {
    case "user":
      return [grammarCandidate("enable")];
    case "privileged":
      return [
        grammarCandidate("configure terminal"),
        grammarCandidate("show ip interface brief"),
        grammarCandidate("ping " + p.remoteTarget, 1),
        grammarCandidate("show ip route"),
        grammarCandidate("copy running-config startup-config"),
      ];
    case "global":
      return [
        grammarCandidate("interface " + p.interfaceName, 1),
        grammarCandidate("ip route 0.0.0.0 0.0.0.0 " + p.gateway, 2, 3, 4),
        grammarCandidate("no ip route 0.0.0.0 0.0.0.0 " + p.gateway, 3, 4, 5),
        grammarCandidate("no ip route 0.0.0.0 0.0.0.0 " + p.wrongGateway, 3, 4, 5),
        grammarCandidate("exit"),
        grammarCandidate("end"),
      ];
    case "interface":
      return [
        grammarCandidate("ip address " + p.localAddress + " " + p.subnetMask, 2, 3),
        grammarCandidate("no shutdown"),
        grammarCandidate("shutdown"),
        grammarCandidate("no ip address"),
        grammarCandidate("exit"),
        grammarCandidate("end"),
      ];
  }
};

const expandScenarioAbbreviation = (state: Ipv4ScenarioState, input: string): string => {
  const typed = input.split(" ");
  let candidates = scenarioGrammar(state).filter((candidate) => {
    const canonical = candidate.canonical.split(" ");
    return canonical.length === typed.length && canonical.every((token, index) =>
      candidate.argumentIndexes.has(index)
        ? token.toLocaleLowerCase("en-GB") === typed[index].toLocaleLowerCase("en-GB")
        : token.toLocaleLowerCase("en-GB").startsWith(typed[index].toLocaleLowerCase("en-GB")));
  });
  for (const [index, typedToken] of typed.entries()) {
    const exactKeyword = candidates.some((candidate) => {
      const token = candidate.canonical.split(" ")[index];
      return !candidate.argumentIndexes.has(index)
        && token.toLocaleLowerCase("en-GB") === typedToken.toLocaleLowerCase("en-GB");
    });
    if (exactKeyword) {
      candidates = candidates.filter((candidate) => {
        const token = candidate.canonical.split(" ")[index];
        return !candidate.argumentIndexes.has(index)
          && token.toLocaleLowerCase("en-GB") === typedToken.toLocaleLowerCase("en-GB");
      });
    }
  }
  const canonical = new Set(candidates.map((candidate) => candidate.canonical));
  return canonical.size === 1 ? [...canonical][0] : input;
};

const isIpv4 = (value: string) => {
  const octets = value.split(".");
  return octets.length === 4 && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
};
const isSubnetMask = (value: string) => {
  if (!isIpv4(value)) return false;
  const bits = value.split(".").map(octet => Number(octet).toString(2).padStart(8, "0")).join("");
  return bits.includes("1") && /^1+0*$/.test(bits);
};

const parseCommand = (input: string): ParseResult => {
  const lower = input.toLowerCase();
  if (lower === "enable") return { command: { kind: "enable" } };
  if (lower === "configure terminal") return { command: { kind: "configure-terminal" } };
  if (lower === "no shutdown") return { command: { kind: "no-shutdown" } };
  if (lower === "shutdown") return { command: { kind: "shutdown" } };
  if (lower === "no ip address") return { command: { kind: "no-ip-address" } };
  if (lower === "exit") return { command: { kind: "exit" } };
  if (lower === "end") return { command: { kind: "end" } };
  if (lower === "show ip interface brief") return { command: { kind: "show-ip-interface-brief" } };
  if (lower === "show ip route") return { command: { kind: "show-ip-route" } };
  if (lower === "copy running-config startup-config") return { command: { kind: "save" } };

  const interfaceMatch = /^interface\s+(\S+)$/i.exec(input);
  if (interfaceMatch) return { command: { kind: "interface", interfaceName: interfaceMatch[1] } };

  if (/^interface(?:\s|$)/i.test(input)) {
    return { errorCode: "INVALID_SYNTAX", message: "An interface identifier is required after the interface keyword." };
  }

  const addressMatch = /^ip\s+address\s+(\S+)\s+(\S+)$/i.exec(input);
  if (addressMatch) {
    if (!isIpv4(addressMatch[1])) return { errorCode: "INVALID_IPV4", message: "The interface address is not valid dotted-decimal IPv4." };
    if (!isSubnetMask(addressMatch[2])) return { errorCode: "INVALID_MASK", message: "The command requires a contiguous dotted-decimal subnet mask, not a wildcard mask." };
    return { command: { kind: "ip-address", address: addressMatch[1], mask: addressMatch[2] } };
  }
  if (/^ip\s+address(?:\s|$)/i.test(input)) {
    return { errorCode: "INVALID_SYNTAX", message: "Both an IPv4 address and a dotted-decimal subnet mask are required." };
  }

  const pingMatch = /^ping\s+(\S+)$/i.exec(input);
  if (pingMatch) {
    if (!isIpv4(pingMatch[1])) return { errorCode: "INVALID_IPV4", message: "The ping destination is not a valid IPv4 address." };
    return { command: { kind: "ping", target: pingMatch[1] } };
  }
  if (/^ping(?:\s|$)/i.test(input)) return { errorCode: "INVALID_SYNTAX", message: "An IPv4 destination is required for this reachability test." };

  const removeRouteMatch = /^no\s+ip\s+route\s+0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)$/i.exec(input);
  if (removeRouteMatch) {
    if (!isIpv4(removeRouteMatch[1])) return { errorCode: "INVALID_IPV4", message: "The route next hop is not a valid IPv4 address." };
    return { command: { kind: "remove-default-route", nextHop: removeRouteMatch[1] } };
  }

  const routeMatch = /^ip\s+route\s+0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)$/i.exec(input);
  if (routeMatch) {
    if (!isIpv4(routeMatch[1])) return { errorCode: "INVALID_IPV4", message: "The route next hop is not a valid IPv4 address." };
    return { command: { kind: "default-route", nextHop: routeMatch[1] } };
  }
  if (/^(?:no\s+)?ip\s+route(?:\s|$)/i.test(input)) {
    return { errorCode: "INVALID_SYNTAX", message: "This lab expects an IPv4 default route with destination, mask and next hop." };
  }

  return { errorCode: "UNSUPPORTED", message: "That text is not a supported command in this bounded learning lab." };
};

const requiredModes: Record<ParsedCommand["kind"], Ipv4ScenarioMode[]> = {
  "enable": ["user"],
  "configure-terminal": ["privileged"],
  "interface": ["global"],
  "ip-address": ["interface"],
  "no-shutdown": ["interface"],
  "shutdown": ["interface"],
  "no-ip-address": ["interface"],
  "exit": ["interface", "global"],
  "end": ["interface", "global"],
  "show-ip-interface-brief": ["privileged"],
  "ping": ["privileged"],
  "show-ip-route": ["privileged"],
  "default-route": ["global"],
  "remove-default-route": ["global"],
  "save": ["privileged"],
};

const expectedKinds = (state: Ipv4ScenarioState): ParsedCommand["kind"][] => {
  switch (state.phase) {
    case "gain-privilege": return ["enable"];
    case "enter-global":
    case "repair-enter-global":
    case "rollback-enter-global": return ["configure-terminal"];
    case "select-interface":
    case "rollback-select-interface": return ["interface"];
    case "configure-address": return ["ip-address"];
    case "enable-interface": return ["no-shutdown"];
    case "return-to-exec":
    case "repair-return-to-exec":
    case "rollback-return-to-exec": return ["exit", "end"];
    case "inspect-interface":
    case "rollback-inspect-interface": return ["show-ip-interface-brief"];
    case "test-initial-reachability":
    case "retest-reachability": return ["ping"];
    case "inspect-routing-table": return ["show-ip-route"];
    case "rollback-inspect-routing-table": return ["show-ip-route"];
    case "remove-faulty-route":
    case "rollback-remove-route": return ["remove-default-route"];
    case "add-default-route": return ["default-route"];
    case "save-working-config":
    case "save-rollback": return ["save"];
    case "rollback-disable-interface": return ["shutdown"];
    case "rollback-remove-address": return ["no-ip-address"];
    default: return [];
  }
};

const modeLabel = (mode: Ipv4ScenarioMode) => {
  switch (mode) {
    case "user": return "User EXEC";
    case "privileged": return "Privileged EXEC";
    case "global": return "Global configuration";
    case "interface": return "Interface configuration";
  }
};

const interfaceOperational = (state: Ipv4ScenarioState) =>
  state.interfaceState.adminUp && state.interfaceState.address !== null;

const runningConfiguration = (state: Ipv4ScenarioState) => {
  const { parameters, interfaceState } = state;
  return [
    "hostname R1",
    `interface ${parameters.interfaceName}`,
    interfaceState.address && interfaceState.mask
      ? ` ip address ${interfaceState.address} ${interfaceState.mask}`
      : " no ip address",
    interfaceState.adminUp ? " no shutdown" : " shutdown",
    " exit",
    state.defaultRoute ? `ip route 0.0.0.0 0.0.0.0 ${state.defaultRoute}` : "",
    "end",
  ].filter(Boolean).join("\n");
};

const interfaceBriefOutput = (state: Ipv4ScenarioState) => {
  const address = state.interfaceState.address ?? "unassigned";
  const operational = interfaceOperational(state);
  const status = state.interfaceState.adminUp ? "up" : "administratively down";
  const protocol = operational ? "up" : "down";
  return [
    "Interface              IP-Address      OK? Method Status                Protocol",
    `${state.parameters.interfaceName.padEnd(23)}${address.padEnd(16)}YES manual ${status.padEnd(22)}${protocol}`,
  ];
};

const routeOutput = (state: Ipv4ScenarioState) => {
  const lines = [
    "Codes: C - connected, L - local, S - static, * - candidate default",
    state.defaultRoute
      ? `Gateway of last resort is ${state.defaultRoute} to network 0.0.0.0`
      : "Gateway of last resort is not set",
  ];
  if (interfaceOperational(state)) {
    lines.push(`C    ${state.parameters.networkAddress}/${state.parameters.prefixLength} is directly connected, ${state.parameters.interfaceName}`);
    lines.push(`L    ${state.parameters.localAddress}/32 is directly connected, ${state.parameters.interfaceName}`);
  }
  if (state.defaultRoute) lines.push(`S*   0.0.0.0/0 [1/0] via ${state.defaultRoute}`);
  return lines;
};

const pingOutput = (state: Ipv4ScenarioState, target: string) => {
  const reachable = target === state.parameters.remoteTarget
    && interfaceOperational(state)
    && state.defaultRoute === state.parameters.gateway;
  return [
    "Type escape sequence to abort.",
    `Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`,
    reachable ? "!!!!!" : ".....",
    reachable ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms" : "Success rate is 0 percent (0/5)",
  ];
};

interface LearningCopy {
  explanation: string;
  useCase: string;
  verification: string;
  rollback: string;
  example?: string;
}

const learningFor = (kind: ParsedCommand["kind"]): LearningCopy => {
  switch (kind) {
    case "enable": return { explanation: "Privileged EXEC mode exposes operational verification and configuration entry commands.", useCase: "Engineers enter this mode before inspecting protected state or making a change.", verification: "A hash prompt confirms Privileged EXEC mode.", rollback: "Return to User EXEC mode when privileged access is no longer needed." };
    case "configure-terminal": return { explanation: "Global configuration mode changes the active running configuration.", useCase: "Use it as the parent context for interface and routing changes.", verification: "The prompt includes (config) while this context is active.", rollback: "Leave the configuration context without saving if the intended change should not persist after reload." };
    case "interface": return { explanation: "Interface configuration context scopes subsequent commands to one port.", useCase: "Select the exact physical or logical interface before changing its Layer 3 state.", verification: "Confirm the (config-if) prompt and later inspect the named interface.", rollback: "Exit the interface context; leaving the context alone does not undo its configuration." };
    case "ip-address": return { explanation: "The IPv4 address and subnet mask define the interface's Layer 3 identity and connected network.", useCase: "A routed interface needs an address from the attached subnet before it can originate or receive IPv4 traffic.", verification: "Inspect the concise interface summary and connected routing-table entries.", rollback: "Remove the interface IPv4 address explicitly; exiting configuration mode does not remove it." };
    case "no-shutdown": return { explanation: "The administrative shutdown state has been removed. With the simulated link present, Status and Protocol can become up/up.", useCase: "Router interfaces are commonly enabled only after their intended configuration has been checked.", verification: "Look for up in both the Status and Protocol columns.", rollback: "Administratively disable the interface if the service must be withdrawn safely." };
    case "shutdown": return { explanation: "The interface is now administratively disabled, so it cannot forward traffic.", useCase: "A controlled rollback often disables a newly commissioned link before its addressing is removed.", verification: "The interface summary should report administratively down and protocol down.", rollback: "Re-enable the interface only after its configuration and cabling have been checked." };
    case "no-ip-address": return { explanation: "The Layer 3 address and connected prefix have been removed from the interface.", useCase: "Remove addressing when decommissioning a routed port or correcting an incorrect subnet assignment.", verification: "The concise summary should show unassigned and the connected route should disappear.", rollback: "Restore the documented address and mask if the removal was unintended." };
    case "exit":
    case "end": return { explanation: "The CLI context changed without altering the interface or route configuration.", useCase: "Return to an EXEC prompt before operational verification commands.", verification: "The prompt identifies the current mode.", rollback: "Re-enter the appropriate configuration context if another controlled change is needed." };
    case "show-ip-interface-brief": return { explanation: "The summary separates administrative or physical Status from line Protocol state and displays the assigned address.", useCase: "This is a fast first check when an interface or connected service is unavailable.", verification: "For a working routed link, confirm the intended address and up/up state.", rollback: "This is read-only; no rollback is needed." };
    case "ping": return { explanation: "ICMP echo tests provide evidence of end-to-end IPv4 reachability, but a failure does not identify the cause by itself.", useCase: "Use a ping after checking local state to validate the complete forwarding path.", verification: "Read the success rate instead of relying only on the exclamation-mark shorthand.", rollback: "This is read-only; no rollback is needed." };
    case "show-ip-route": return { explanation: "The routing table shows the connected prefix and the gateway of last resort used for unknown destinations.", useCase: "Inspect routes after a local interface works but a remote destination remains unreachable.", verification: "Confirm that the default next hop belongs to the connected branch subnet.", rollback: "This is read-only; no rollback is needed." };
    case "default-route": return { explanation: "A static default route now forwards destinations with no more-specific match towards the branch gateway.", useCase: "Small branch routers often use one upstream gateway for all non-local networks.", verification: "Inspect the candidate default in the routing table, then repeat the original reachability test.", rollback: "Remove the exact static route, including its next hop, if the path is wrong or decommissioned." };
    case "remove-default-route": return { explanation: "The specified static default route has been removed without changing the connected interface route.", useCase: "Delete a stale next hop before installing the documented route, or remove lab routing during rollback.", verification: "Inspect the routing table and confirm the unwanted candidate default is absent.", rollback: "Reinstall the documented default route if removal interrupts intended upstream connectivity." };
    case "save": return { explanation: "The current running configuration has been copied into simulated startup storage.", useCase: "Persist a verified change so it survives a device reload.", verification: "The simulator reports a completed configuration build and records an immutable startup snapshot.", rollback: "After undoing a change, save again so the startup configuration also reflects the rollback." };
  }
};

const workedExampleFor = (kind: ParsedCommand["kind"], state: Ipv4ScenarioState): string => {
  const p = state.parameters;
  switch (kind) {
    case "enable": return "R1> enable  →  R1# — the prompt changes, but device configuration does not.";
    case "configure-terminal": return "R1# configure terminal  →  R1(config)# — configuration commands are now available.";
    case "interface": return `R1(config)# interface ${p.interfaceName}  →  R1(config-if)# — later changes are scoped to that port.`;
    case "ip-address": return `R1(config-if)# ip address ${p.localAddress} ${p.subnetMask} — address and mask must describe the same subnet.`;
    case "no-shutdown": return "R1(config-if)# no shutdown — removes the administrative block; it does not repair cabling or a peer fault.";
    case "shutdown": return "R1(config-if)# shutdown — deliberately withdraws the interface before its temporary addressing is removed.";
    case "no-ip-address": return "R1(config-if)# no ip address — removes both the interface address and its connected route.";
    case "exit":
    case "end": return "R1(config-if)# end  →  R1# — return to EXEC mode before running operational show commands.";
    case "show-ip-interface-brief": return `Look for ${p.interfaceName}, ${p.localAddress}, Status up and Protocol up in the same row.`;
    case "ping": return `R1# ping ${p.remoteTarget} — “!!!!!” and 100 percent indicate replies; “.....” and 0 percent only prove failure, not its cause.`;
    case "show-ip-route": return `Compare “Gateway of last resort” with ${p.gateway}; a connected ${p.networkAddress}/${p.prefixLength} alone cannot reach every remote prefix.`;
    case "default-route": return `R1(config)# ip route 0.0.0.0 0.0.0.0 ${p.gateway} — unmatched IPv4 traffic is sent to the documented upstream gateway.`;
    case "remove-default-route": return `Use the exact no form with the installed next hop; removing ${p.wrongGateway} does not remove the connected LAN route.`;
    case "save": return "R1# copy running-config startup-config — only save after the interface, route and reachability checks agree.";
  }
};

const rejected = (
  state: Ipv4ScenarioState,
  errorCode: Ipv4ScenarioErrorCode,
  explanation: string,
  output = ["% Command rejected by the learning lab; the simulated device state was not changed."],
): Ipv4ScenarioActionResult => ({
  accepted: false,
  state: cloneState(state),
  output,
  explanation,
  useCase: "Read the prompt and objective together: IOS command availability depends on both context and intent.",
  verification: `The prompt is ${ipv4ScenarioPrompt(state)} and no simulated state changed.`,
  rollback: "No rollback is required because rejected input is inert.",
  nextObjective: getIpv4ScenarioObjective(state),
  errorCode,
});

const valuesMatch = (state: Ipv4ScenarioState, command: ParsedCommand): string | null => {
  const p = state.parameters;
  switch (command.kind) {
    case "interface":
      return command.interfaceName.toLowerCase() === p.interfaceName.toLowerCase()
        ? null
        : "That is a valid interface selection structure, but it is not the branch LAN interface named in the task.";
    case "ip-address":
      return command.address === p.localAddress && command.mask === p.subnetMask
        ? null
        : "The address or subnet mask is valid, but it does not match the branch addressing plan.";
    case "ping":
      return command.target === p.remoteTarget
        ? null
        : "That is a valid IPv4 target, but it is not the remote service named in this test.";
    case "default-route":
      return command.nextHop === p.gateway
        ? null
        : "The next hop is valid IPv4, but it is not the documented branch gateway.";
    case "remove-default-route": {
      const expected = state.phase === "remove-faulty-route" ? p.wrongGateway : p.gateway;
      return command.nextHop === expected
        ? null
        : "The removal syntax is valid, but it does not identify the route currently targeted by the objective.";
    }
    default:
      return null;
  }
};

const applyParsedCommand = (state: Ipv4ScenarioState, command: ParsedCommand) => {
  let output: string[] = [];
  switch (command.kind) {
    case "enable": state.mode = "privileged"; break;
    case "configure-terminal": state.mode = "global"; output = ["Enter configuration commands, one per line. End with CNTL/Z."]; break;
    case "interface": state.mode = "interface"; state.selectedInterface = command.interfaceName; break;
    case "ip-address": state.interfaceState.address = command.address; state.interfaceState.mask = command.mask; break;
    case "no-shutdown":
      state.interfaceState.adminUp = true;
      output = [
        `%LINK-3-UPDOWN: Interface ${state.parameters.interfaceName}, changed state to up`,
        `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${state.parameters.interfaceName}, changed state to up`,
      ];
      break;
    case "shutdown":
      state.interfaceState.adminUp = false;
      output = [
        `%LINK-5-CHANGED: Interface ${state.parameters.interfaceName}, changed state to administratively down`,
        `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${state.parameters.interfaceName}, changed state to down`,
      ];
      break;
    case "no-ip-address": state.interfaceState.address = null; state.interfaceState.mask = null; break;
    case "exit": state.mode = state.mode === "interface" ? "global" : "privileged"; break;
    case "end": state.mode = "privileged"; break;
    case "show-ip-interface-brief": output = interfaceBriefOutput(state); break;
    case "ping": output = pingOutput(state, command.target); break;
    case "show-ip-route": output = routeOutput(state); break;
    case "default-route": state.defaultRoute = command.nextHop; break;
    case "remove-default-route": state.defaultRoute = null; break;
    case "save": {
      const configuration = runningConfiguration(state);
      state.startup = {
        interfaceState: { ...state.interfaceState },
        defaultRoute: state.defaultRoute,
        configuration,
      };
      output = ["Destination filename [startup-config]?", "Building configuration...", "[OK]"];
      break;
    }
  }
  return output;
};

const advancePhase = (state: Ipv4ScenarioState, command: ParsedCommand) => {
  switch (state.phase) {
    case "gain-privilege": state.phase = "enter-global"; break;
    case "enter-global": state.phase = "select-interface"; break;
    case "select-interface": state.phase = "configure-address"; break;
    case "configure-address": state.phase = "enable-interface"; break;
    case "enable-interface": state.phase = "return-to-exec"; break;
    case "return-to-exec": if (state.mode === "privileged") state.phase = "inspect-interface"; break;
    case "inspect-interface": state.phase = "interpret-interface"; break;
    case "test-initial-reachability": state.phase = "inspect-routing-table"; break;
    case "inspect-routing-table": state.phase = "diagnose-routing-fault"; break;
    case "repair-enter-global": state.phase = state.fault === "wrong-default-next-hop" ? "remove-faulty-route" : "add-default-route"; break;
    case "remove-faulty-route": state.phase = "add-default-route"; break;
    case "add-default-route": state.phase = "repair-return-to-exec"; break;
    case "repair-return-to-exec": if (state.mode === "privileged") state.phase = "retest-reachability"; break;
    case "retest-reachability": state.phase = "save-working-config"; break;
    case "save-working-config": state.phase = "rollback-enter-global"; break;
    case "rollback-enter-global": state.phase = "rollback-remove-route"; break;
    case "rollback-remove-route": state.phase = "rollback-select-interface"; break;
    case "rollback-select-interface": state.phase = "rollback-disable-interface"; break;
    case "rollback-disable-interface": state.phase = "rollback-remove-address"; break;
    case "rollback-remove-address": state.phase = "rollback-return-to-exec"; break;
    case "rollback-return-to-exec": if (state.mode === "privileged") state.phase = "rollback-inspect-interface"; break;
    case "rollback-inspect-interface": state.phase = "interpret-rollback"; break;
    case "rollback-inspect-routing-table": state.phase = "save-rollback"; break;
    case "save-rollback": state.phase = "complete"; break;
    default: break;
  }
  // Avoid an unused-parameter lint exception while retaining a narrow transition API.
  void command;
};

export const runIpv4ScenarioCommand = (current: Ipv4ScenarioState, raw: string): Ipv4ScenarioActionResult => {
  if (current.phase === "complete") return rejected(current, "SCENARIO_COMPLETE", "This scenario is already complete.");
  if (["interpret-interface", "diagnose-routing-fault", "interpret-rollback"].includes(current.phase)) {
    return rejected(current, "INTERPRETATION_REQUIRED", "This step asks you to interpret evidence rather than type another command.");
  }

  const input = normalise(raw);
  if (!input) return rejected(current, "EMPTY", "Type a command before submitting.");
  if (input.length > 256) return rejected(current, "TOO_LONG", "The command exceeds the 256-character learning-lab limit.");

  const parsed = parseCommand(expandScenarioAbbreviation(current, input));
  if ("errorCode" in parsed) {
    return rejected(current, parsed.errorCode, parsed.message, [
      "                         ^",
      "% Invalid input detected at '^' marker.",
    ]);
  }

  const command = parsed.command;
  if (!requiredModes[command.kind].includes(current.mode)) {
    return rejected(
      current,
      "WRONG_MODE",
      `That command family is not available in ${modeLabel(current.mode)} mode. Use the prompt to choose the correct context.`,
      [`% Command unavailable from ${ipv4ScenarioPrompt(current)}`],
    );
  }

  if (!expectedKinds(current).includes(command.kind)) {
    return rejected(current, "WRONG_STEP", "That is a supported command, but it does not complete the current operational objective.");
  }

  const mismatch = valuesMatch(current, command);
  if (mismatch) return rejected(current, "WRONG_VALUE", mismatch);

  const state = cloneState(current);
  const output = applyParsedCommand(state, command);
  state.acceptedActions += 1;
  advancePhase(state, command);
  const learning = learningFor(command.kind);
  return {
    accepted: true,
    state,
    output,
    ...learning,
    example: workedExampleFor(command.kind, current),
    nextObjective: getIpv4ScenarioObjective(state),
  };
};

const expectedInterpretation = (state: Ipv4ScenarioState): Ipv4ScenarioChoiceId | null => {
  switch (state.phase) {
    case "interpret-interface": return "interface-operational";
    case "diagnose-routing-fault": return state.fault;
    case "interpret-rollback": return "rollback-complete";
    default: return null;
  }
};

export const submitIpv4ScenarioInterpretation = (
  current: Ipv4ScenarioState,
  choice: Ipv4ScenarioChoiceId,
): Ipv4ScenarioActionResult => {
  const expected = expectedInterpretation(current);
  if (!expected) return rejected(current, "COMMAND_REQUIRED", "The current step requires an IOS command rather than an interpretation choice.");
  if (!getIpv4ScenarioChoices(current).some(option => option.id === choice)) {
    return rejected(current, "WRONG_INTERPRETATION", "That conclusion is not supported by the available evidence. Re-read the relevant status or routing output.");
  }
  if (choice !== expected) {
    const explanation = current.phase === "diagnose-routing-fault"
      ? "The failed address-based ping rules out DNS, while the routing table directly identifies the default-route problem."
      : "Read the IP-Address, Status and Protocol columns together; no single column proves the whole interface state.";
    return rejected(current, "WRONG_INTERPRETATION", explanation);
  }

  const state = cloneState(current);
  state.acceptedActions += 1;
  let learning: LearningCopy;
  if (state.phase === "interpret-interface") {
    state.phase = "test-initial-reachability";
    learning = {
      explanation: "The intended IPv4 address plus up/up confirms that the local interface is configured, enabled and has an operational line protocol.",
      useCase: "Separate local interface health from upstream routing before diagnosing an end-to-end failure.",
      verification: "The next reachability test checks beyond the local link.",
      rollback: "A read-only interpretation does not require rollback.",
      example: `Address ${state.parameters.localAddress} plus Status up and Protocol up supports “interface operational”; any one field alone would be incomplete evidence.`,
    };
  } else if (state.phase === "diagnose-routing-fault") {
    state.phase = "repair-enter-global";
    learning = state.fault === "missing-default-route"
      ? {
          explanation: "The connected LAN is present, but no gateway of last resort exists for the remote destination.",
          useCase: "This distinction prevents unnecessary interface changes when local Layer 3 state is already healthy.",
          verification: "After repair, inspect the candidate default and repeat the original ping.",
          rollback: "Remove the added static default route by matching its destination, mask and next hop.",
          example: `A connected ${state.parameters.networkAddress}/${state.parameters.prefixLength} route proves the LAN, while “Gateway of last resort is not set” explains why ${state.parameters.remoteTarget} has no path.`,
        }
      : {
          explanation: "A default route exists, but its next hop does not match the documented branch gateway.",
          useCase: "A route can be present yet still be operationally wrong; validate values as well as route existence.",
          verification: "After repair, confirm the gateway of last resort and repeat the original ping.",
          rollback: "Remove the incorrect route before adding the documented next hop.",
          example: `The table may contain 0.0.0.0/0, but ${state.parameters.wrongGateway} is still wrong because the work order specifies ${state.parameters.gateway}.`,
        };
  } else {
    state.phase = "rollback-inspect-routing-table";
    learning = {
      explanation: "Unassigned plus administratively down confirms that both Layer 3 addressing and the enabled state were rolled back.",
      useCase: "Post-change verification is as important for removals as it is for service activation.",
      verification: "Inspect the routing table next to prove that the temporary gateway of last resort was also removed before saving.",
      rollback: "Restore the documented interface address and enable the port if the rollback itself must be reversed.",
      example: `The rollback evidence must combine IP-Address unassigned with Status administratively down; checking only Protocol down would not prove why it is down.`,
    };
  }

  return {
    accepted: true,
    state,
    output: [],
    ...learning,
    nextObjective: getIpv4ScenarioObjective(state),
  };
};
