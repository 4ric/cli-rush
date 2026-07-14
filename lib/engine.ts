import { expandedCommands } from "./expanded-catalogue.ts";
import { teachingExplanation } from "./command-teaching.ts";
import {
  buildCommandRegistry,
  parseRegistryInput,
  profileIdsForCommand,
  redactCredentialInput as redactCredentialText,
  redactRegistryInput,
  type ParsedCommandEvent,
  type RegistryContext,
  type RegistryParseResult,
} from "./command-registry.ts";
import {
  getDeviceProfile,
  normaliseInterfaceName,
  parseInterfaceRange,
  type DeviceProfileId,
} from "./device-profiles.ts";
import { learningTaskFor, learningTaskSatisfied } from "./learning-tasks.ts";

export type CliMode = "user" | "privileged" | "global" | "interface" | "router" | "line" | "vlan" | "acl" | "dhcp";
export type CliContext = RegistryContext;
export type CommandKind = "navigation" | "verification" | "configuration";

export interface Command {
  id: string;
  mode: CliMode;
  canonical: string;
  objective: string;
  explanation: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  kind: CommandKind;
  custom?: boolean;
  deviceProfile?: DeviceProfileId;
  /** Zero-based canonical token positions whose values are case-sensitive. */
  caseSensitiveTokens?: readonly number[];
}

const c = (id: string, mode: CliMode, canonical: string, objective: string, topic: string, kind: CommandKind, difficulty: 1 | 2 | 3 = 1): Command =>
  ({ id, mode, canonical, objective, topic, kind, difficulty, explanation: explanations[id] ?? `Runs ${canonical} in the simulator.` });

const explanations: Record<string, string> = {
  "nav.enable": "Moves from User EXEC to Privileged EXEC mode.",
  "nav.disable": "Returns from Privileged EXEC to User EXEC mode.",
  "nav.configure": "Enters global configuration mode.",
  "show.ip-interface-brief": "Shows interface addresses and line or protocol status in a compact table.",
  "show.running": "Displays the active configuration held in memory.",
  "show.startup": "Displays the saved startup configuration.",
  "config.save": "Copies the active simulated configuration into startup storage.",
  "config.hostname": "Changes the simulated device name and prompt.",
  "nav.interface": "Selects an interface and opens its configuration context.",
  "interface.ipv4": "Assigns an IPv4 address and subnet mask to the selected interface.",
  "interface.no-shutdown": "Removes the administrative shutdown state.",
  "interface.shutdown": "Places the interface into an administratively down state.",
  "route.default": "Adds a simulated gateway of last resort.",
  "router.network": "Matches the documentation subnet for simulated OSPF area 0.",
};

const coreCommands: Command[] = [
  c("nav.enable", "user", "enable", "Enter privileged EXEC mode.", "CLI navigation", "navigation"),
  c("tools.ping", "user", "ping 192.0.2.1", "Test IPv4 reachability to 192.0.2.1.", "Connectivity", "verification"),
  c("tools.traceroute", "user", "traceroute 198.51.100.10", "Trace the simulated path to 198.51.100.10.", "Connectivity", "verification", 2),
  c("nav.disable", "privileged", "disable", "Return to User EXEC mode.", "CLI navigation", "navigation"),
  c("nav.configure", "privileged", "configure terminal", "Enter global configuration mode.", "CLI navigation", "navigation"),
  c("show.version", "privileged", "show version", "Display software and platform information.", "Device verification", "verification"),
  c("show.running", "privileged", "show running-config", "Display the active configuration.", "Configuration management", "verification"),
  c("show.startup", "privileged", "show startup-config", "Display the saved startup configuration.", "Configuration management", "verification"),
  c("config.save", "privileged", "copy running-config startup-config", "Save the running configuration.", "Configuration management", "configuration"),
  c("show.ip-interface-brief", "privileged", "show ip interface brief", "Display a concise summary of interface addresses and status.", "Interface verification", "verification"),
  c("show.interfaces", "privileged", "show interfaces", "Display detailed information for all interfaces.", "Interface verification", "verification"),
  c("show.ip-route", "privileged", "show ip route", "Display the IPv4 routing table.", "Routing", "verification"),
  c("show.vlan", "privileged", "show vlan brief", "Display a concise VLAN summary.", "Layer 2 switching", "verification"),
  c("show.cdp", "privileged", "show cdp neighbors", "Display directly connected CDP neighbours.", "Neighbour discovery", "verification"),
  c("config.hostname", "global", "hostname Branch-R1", "Set the hostname to Branch-R1.", "Device configuration", "configuration"),
  c("config.no-domain-lookup", "global", "no ip domain-lookup", "Disable DNS lookup for mistyped commands.", "Device configuration", "configuration", 2),
  c("config.password-encryption", "global", "service password-encryption", "Enable reversible password obfuscation.", "Device hardening", "configuration", 2),
  c("nav.interface", "global", "interface GigabitEthernet0/1", "Open configuration for GigabitEthernet0/1.", "CLI navigation", "navigation"),
  c("route.default", "global", "ip route 0.0.0.0 0.0.0.0 192.0.2.254", "Add a default route through 192.0.2.254.", "Routing", "configuration", 3),
  c("nav.router", "global", "router ospf 10", "Enter OSPF router configuration for process 10.", "Routing", "navigation", 2),
  c("nav.exit-global", "global", "exit", "Leave global configuration mode.", "CLI navigation", "navigation"),
  c("interface.description", "interface", "description Uplink to SW1", "Describe the interface as Uplink to SW1.", "Interface configuration", "configuration"),
  c("interface.ipv4", "interface", "ip address 192.0.2.1 255.255.255.0", "Set 192.0.2.1/24 on the selected interface.", "Interface configuration", "configuration", 2),
  c("interface.no-shutdown", "interface", "no shutdown", "Administratively enable the interface.", "Interface configuration", "configuration"),
  c("interface.shutdown", "interface", "shutdown", "Administratively disable the interface.", "Interface configuration", "configuration"),
  c("interface.no-ip", "interface", "no ip address", "Remove the IPv4 address.", "Interface configuration", "configuration", 2),
  c("interface.duplex", "interface", "duplex full", "Set full duplex.", "Interface configuration", "configuration", 2),
  c("interface.speed", "interface", "speed 1000", "Set the interface speed to 1000 Mbps.", "Interface configuration", "configuration", 2),
  c("interface.access", "interface", "switchport mode access", "Set static access mode.", "Layer 2 switching", "configuration", 2),
  c("interface.vlan", "interface", "switchport access vlan 20", "Assign the access port to VLAN 20.", "Layer 2 switching", "configuration", 2),
  c("nav.exit-interface", "interface", "exit", "Leave interface configuration one level.", "CLI navigation", "navigation"),
  c("nav.end-interface", "interface", "end", "Return directly to Privileged EXEC mode.", "CLI navigation", "navigation"),
  c("router.network", "router", "network 192.0.2.0 0.0.0.255 area 0", "Advertise 192.0.2.0/24 in OSPF area 0.", "OSPF", "configuration", 3),
  c("router.passive", "router", "passive-interface GigabitEthernet0/1", "Make GigabitEthernet0/1 passive in OSPF.", "OSPF", "configuration", 3),
  c("nav.exit-router", "router", "exit", "Leave router configuration one level.", "CLI navigation", "navigation"),
  c("nav.end-router", "router", "end", "Return directly to Privileged EXEC mode.", "CLI navigation", "navigation"),
];

export const commands: Command[] = [...coreCommands, ...expandedCommands].map((command) => ({
  ...command,
  explanation: teachingExplanation(command),
}));

export const commandById = new Map(commands.map(command => [command.id, command]));
export const modeNames: Record<CliContext, string> = {
  user: "User EXEC",
  privileged: "Privileged EXEC",
  global: "Global configuration",
  interface: "Interface configuration",
  router: "Router configuration",
  line: "Line configuration",
  vlan: "VLAN configuration",
  acl: "Named ACL configuration",
  dhcp: "DHCP pool configuration",
  radius: "RADIUS server configuration",
  subinterface: "Router subinterface configuration",
  "interface-range": "Interface range configuration",
  "acl-standard": "Named standard ACL configuration",
  "acl-extended": "Named extended ACL configuration",
  "aaa-group": "AAA RADIUS server-group configuration",
};

export type ErrorCode = "EMPTY" | "TOO_LONG" | "WRONG_MODE" | "MISSING_KEYWORD" | "MISSING_ARGUMENT" | "KEYWORD_ORDER" | "EXTRA_INPUT" | "INVALID_IPV4" | "INVALID_MASK" | "MASK_KIND" | "INVALID_INTERFACE" | "WRONG_VALUE" | "VERIFY_NOT_CONFIGURE" | "CONFIGURE_NOT_VERIFY" | "WRONG_OBJECTIVE" | "UNSUPPORTED";
export type Validation = { ok: true; command: Command; input: string } | { ok: false; input: string; code: ErrorCode; message: string };
export const normalise = (input: string) => input.trim().replace(/\s+/g, " ");
export const isIPv4 = (v: string) => { const o=v.split("."); return o.length===4 && o.every(x=>/^\d{1,3}$/.test(x)&&+x>=0&&+x<=255); };
export const isMask = (v: string, zero=false) => { if(!isIPv4(v)) return false; const bits=v.split(".").map(x=>(+x).toString(2).padStart(8,"0")).join(""); return (zero||bits.includes("1")) && /^1*0*$/.test(bits); };
const same = (a:string,b:string) => a.toLowerCase()===b.toLowerCase();
const secretValueAt = (tokens: readonly string[], index: number): boolean => {
  if (index < 1) return false;
  const previous = tokens[index - 1]?.toLowerCase();
  return previous === "secret" || previous === "key" || previous === "password" || previous === "community";
};
const exactCommandMatch = (input: string, command: Command): boolean => {
  const actual = input.split(" ");
  const expected = command.canonical.split(" ");
  if (actual.length !== expected.length) return false;
  return expected.every((token, index) =>
    command.caseSensitiveTokens?.includes(index) || secretValueAt(expected, index)
      ? actual[index] === token
      : same(actual[index] ?? "", token));
};
const syntaxError = (input:string, expected:Command): Validation | null => {
  const t=input.split(" "), e=expected.canonical.split(" ");
  if (expected.id==="interface.ipv4" && same(t.slice(0,2).join(" "),"ip address")) {
    if(!t[2]||!t[3]) return {ok:false,input,code:"MISSING_ARGUMENT",message:"The IPv4 address and subnet mask are both required."};
    if(!isIPv4(t[2])) return {ok:false,input,code:"INVALID_IPV4",message:`“${t[2]}” is not a valid IPv4 address.`};
    if(!isMask(t[3])) return {ok:false,input,code:t[3].startsWith("0.")?"MASK_KIND":"INVALID_MASK",message:t[3].startsWith("0.")?"That looks like a wildcard mask. This command expects a subnet mask.":`“${t[3]}” is not a contiguous subnet mask.`};
    return {ok:false,input,code:"WRONG_VALUE",message:"The address or mask is valid, but does not match the objective."};
  }
  if (expected.id==="route.default" && same(t.slice(0,2).join(" "),"ip route")) {
    if(t.length<5) return {ok:false,input,code:"MISSING_ARGUMENT",message:"The destination, subnet mask and next-hop address are required."};
    if(!isIPv4(t[2])||!isIPv4(t[4])) return {ok:false,input,code:"INVALID_IPV4",message:"The route contains an invalid IPv4 address."};
    if(!isMask(t[3],true)) return {ok:false,input,code:"INVALID_MASK",message:"The route contains an invalid subnet mask."};
    return {ok:false,input,code:"WRONG_VALUE",message:"The route is valid, but its values do not match the objective."};
  }
  if (expected.id==="nav.interface" && same(t[0]??"","interface")) return {ok:false,input,code:t[1]?"INVALID_INTERFACE":"MISSING_ARGUMENT",message:t[1]?`“${t[1]}” is not the requested simulated interface.`:"The interface argument is missing."};
  const lower=t.map(x=>x.toLowerCase()), expectedLower=e.map(x=>x.toLowerCase());
  if(t.length<e.length && lower.every((x,i)=>x===expectedLower[i])) return {ok:false,input,code:e.slice(t.length).some(x=>x.includes(".")||/\d/.test(x))?"MISSING_ARGUMENT":"MISSING_KEYWORD",message:"The command structure is incomplete."};
  if(t.length>e.length && expectedLower.every((x,i)=>x===lower[i])) return {ok:false,input,code:"EXTRA_INPUT",message:"Unexpected input follows the command."};
  if(expectedLower.length>1 && expectedLower.every(x=>lower.includes(x))) return {ok:false,input,code:"KEYWORD_ORDER",message:"The right keywords are present, but they are in the wrong order."};
  if(same(t[0]??"",e[0])) return {ok:false,input,code:"MISSING_KEYWORD",message:"The command family is close, but a keyword is missing or misplaced."};
  return null;
};

export const validate = (raw:string, mode:CliMode, expectedId:string, catalogue:Command[]=commands):Validation => {
  const input=normalise(raw); if(!input) return {ok:false,input,code:"EMPTY",message:"Type a command before submitting."};
  if(input.length>256) return {ok:false,input,code:"TOO_LONG",message:"The command exceeds the simulator limit."};
  const expected=catalogue.find(command=>command.id===expectedId); if(!expected) throw new Error(`Unknown command ${expectedId}`);
  if(exactCommandMatch(input, expected)) return mode===expected.mode?{ok:true,input,command:expected}:{ok:false,input,code:"WRONG_MODE",message:`Correct command, but it belongs in ${modeNames[expected.mode]} mode. The current prompt is ${modeNames[mode]} mode.`};
  const other=catalogue.find(x=>x.id!==expected.id&&exactCommandMatch(input, x));
  if(other) {
    if(other.mode!==mode) return {ok:false,input,code:"WRONG_MODE",message:`That command is valid from ${modeNames[other.mode]} mode, not ${modeNames[mode]} mode.`};
    if(expected.kind==="configuration"&&other.kind==="verification") return {ok:false,input,code:"VERIFY_NOT_CONFIGURE",message:"That verifies state, but this objective requires a configuration change."};
    if(expected.kind==="verification"&&other.kind==="configuration") return {ok:false,input,code:"CONFIGURE_NOT_VERIFY",message:"That changes configuration, but this objective asks you to verify state."};
    return {ok:false,input,code:"WRONG_OBJECTIVE",message:`That is a valid ${other.topic.toLowerCase()} command, but it does not complete this objective.`};
  }
  return syntaxError(input,expected)??{ok:false,input,code:"UNSUPPORTED",message:"This IOS XE learning pack does not support that command for the current objective."};
};

/** Resolve against the same typed grammar used by help and completion. */
const engineRegistryCache = new WeakMap<object, Map<DeviceProfileId, ReturnType<typeof buildCommandRegistry>>>();

const registryFor = (
  catalogue: readonly Command[],
  profileId: DeviceProfileId,
) => {
  let byProfile = engineRegistryCache.get(catalogue);
  if (!byProfile) {
    byProfile = new Map();
    engineRegistryCache.set(catalogue, byProfile);
  }
  const cached = byProfile.get(profileId);
  if (cached) return cached;
  const registry = buildCommandRegistry(catalogue, getDeviceProfile(profileId), {
    includeSupplemental: catalogue.some((command) => command.id === "nav.enable")
      && catalogue.some((command) => command.id === "nav.configure"),
  });
  byProfile.set(profileId, registry);
  return registry;
};

interface ProfiledParse {
  profileId: DeviceProfileId;
  result: RegistryParseResult;
}

const parseAcrossProfiles = (
  raw: string,
  context: CliContext,
  catalogue: readonly Command[],
  profileId?: DeviceProfileId,
): ProfiledParse => {
  const profileIds: DeviceProfileId[] = profileId
    ? [profileId]
    : ["router-ios-xe", "catalyst-l2"];
  const parsed = profileIds.map((candidate) => ({
    profileId: candidate,
    result: parseRegistryInput(registryFor(catalogue, candidate), raw, context),
  }));
  return parsed.find(({ result }) => result.status === "valid")
    ?? parsed.find(({ result }) => result.status === "ambiguous")
    ?? parsed.find(({ result }) => result.status === "incomplete")
    ?? parsed.find(({ result }) => result.status === "wrong-context")
    ?? parsed[0];
};

const expectedArgumentsMatch = (
  actual: ParsedCommandEvent,
  expected: ParsedCommandEvent,
): boolean => {
  if (actual.production.signature !== expected.production.signature) return false;
  for (const token of expected.production.tokens) {
    if (token.kind !== "argument") continue;
    const actualValue = actual.normalisedArguments[token.name] ?? actual.arguments[token.name];
    const expectedValue = expected.normalisedArguments[token.name] ?? expected.arguments[token.name];
    if (token.caseSensitive) {
      if (actualValue !== expectedValue) return false;
    } else if (!same(actualValue ?? "", expectedValue ?? "")) {
      return false;
    }
  }
  return true;
};

/**
 * Accept IOS keyword abbreviations as normal input while keeping objective
 * values, including credentials, deterministic and exact.
 */
export const validateOperational = (
  raw: string,
  mode: CliMode,
  expectedId: string,
  catalogue: Command[] = commands,
  profileId?: DeviceProfileId,
): Validation => {
  const exact = validate(raw, mode, expectedId, catalogue);
  if (exact.ok) return exact;
  const input = normalise(raw);
  if (!input || input.length > 256) return exact;
  const expected = catalogue.find((command) => command.id === expectedId);
  if (!expected || expected.mode !== mode) return exact;

  const parsed = parseAcrossProfiles(input, mode, catalogue, profileId);
  if (parsed.result.status !== "valid") {
    if (parsed.result.status === "wrong-context") {
      return { ok: false, input, code: "WRONG_MODE", message: parsed.result.message };
    }
    if (parsed.result.status === "incomplete") {
      return { ok: false, input, code: "MISSING_KEYWORD", message: parsed.result.message };
    }
    return exact;
  }
  const expectedParse = parseRegistryInput(
    registryFor(catalogue, parsed.profileId),
    expected.canonical,
    mode,
  );
  if (expectedParse.status === "valid"
    && expectedArgumentsMatch(parsed.result.event, expectedParse.event)) {
    return { ok: true, input, command: expected };
  }
  const actual = parsed.result.event.command as Command;
  if (actual.kind === expected.kind
    && actual.canonical.toLocaleLowerCase("en-GB") === expected.canonical.toLocaleLowerCase("en-GB")) {
    return { ok: false, input, code: "WRONG_VALUE", message: "The command syntax is valid, but a case-sensitive or objective-specific value does not match." };
  }
  if (expected.kind === "configuration" && actual.kind === "verification") {
    return { ok: false, input, code: "VERIFY_NOT_CONFIGURE", message: "That verifies state, but this objective requires a configuration change." };
  }
  if (expected.kind === "verification" && actual.kind === "configuration") {
    return { ok: false, input, code: "CONFIGURE_NOT_VERIFY", message: "That changes configuration, but this objective asks you to verify state." };
  }
  return { ok: false, input, code: "WRONG_OBJECTIVE", message: `That is a valid ${actual.topic.toLocaleLowerCase("en-GB")} command, but it does not complete this objective.` };
};

export type CommandResolution =
  | { status: "valid"; input: string; command: Command; event: ParsedCommandEvent; profileId: DeviceProfileId }
  | { status: "ambiguous"; input: string; matches: Command[]; message: string }
  | { status: "incomplete"; input: string; matches: Command[]; message: string }
  | { status: "wrong-context"; input: string; matches: Command[]; message: string }
  | { status: "invalid"; input: string; message: string };

const commandsFromParse = (result: Exclude<RegistryParseResult, { status: "valid" } | { status: "invalid" }>): Command[] =>
  [...new Map(result.matches.map((production) => [production.command.id, production.command as Command])).values()];

/** Resolve any executable command without consulting the active objective. */
export const resolveCommand = (
  raw: string,
  mode: CliContext,
  catalogue: readonly Command[] = commands,
  profileId?: DeviceProfileId,
): CommandResolution => {
  const parsed = parseAcrossProfiles(raw, mode, catalogue, profileId);
  const result = parsed.result;
  if (result.status === "valid") {
    return {
      status: "valid",
      input: result.input,
      command: result.event.command as Command,
      event: result.event,
      profileId: parsed.profileId,
    };
  }
  if (result.status === "invalid") return { ...result };
  return { ...result, matches: commandsFromParse(result) };
};

/** Redact credential arguments before history, output, logs or persistence. */
export const redactCommandInput = (
  raw: string,
  mode: CliContext,
  catalogue: readonly Command[] = commands,
  profileId: DeviceProfileId = "router-ios-xe",
): string => redactRegistryInput(registryFor(catalogue, profileId), raw, mode);

export interface InterfaceState {
  name: string;
  description: string;
  ipv4: string | null;
  mask: string | null;
  adminUp: boolean;
  carrierUp: boolean;
  encapsulationDot1q: number | null;
  switchportMode: "access" | "trunk" | null;
  accessVlan: number | null;
  voiceVlan: number | null;
  trunkNativeVlan: number | null;
  trunkAllowedVlans: number[];
  portFast: boolean;
  bpduGuard: boolean;
  portSecurity: boolean;
  portSecurityMaximum: number | null;
  portSecurityViolation: string | null;
  channelGroup: number | null;
  channelMode: string | null;
  helperAddress: string | null;
  natRole: "inside" | "outside" | null;
  bandwidthKbps: number | null;
  loadIntervalSeconds: number | null;
  negotiationAuto: boolean;
  stormControlBroadcastLevel: string | null;
  udldPort: boolean;
  dhcpSnoopingRate: number | null;
  touched: boolean;
}

export interface StaticRouteState {
  destination: string;
  mask: string;
  nextHop: string;
  administrativeDistance: number | null;
}

export interface VlanState {
  id: number;
  name: string;
  active: boolean;
}

export interface DhcpPoolState {
  name: string;
  network: string | null;
  mask: string | null;
  defaultRouter: string | null;
  dnsServer: string | null;
  domainName: string | null;
}

export interface RadiusServerState {
  name: string;
  address: string | null;
  authenticationPort: number;
  accountingPort: number;
  keyConfigured: boolean;
  administrativelyDisabled: boolean;
}

export type PendingInteraction =
  | { kind: "save"; destination: "startup-config" }
  | { kind: "reload" }
  | { kind: "erase-startup" }
  | { kind: "default-interface"; interfaceName: string };

export interface DeviceState {
  profileId: DeviceProfileId;
  hostname: string;
  mode: CliMode;
  context: CliContext;
  selectedInterface: string;
  selectedInterfaces: string[];
  selectedVlan: number | null;
  selectedDhcpPool: string | null;
  selectedRadiusServer: string | null;
  selectedAaaGroup: string | null;
  selectedAcl: string | null;
  interfaces: Record<string, InterfaceState>;
  vlans: Record<string, VlanState>;
  staticRoutes: StaticRouteState[];
  routes: string[];
  ipv4: string | null;
  mask: string | null;
  adminUp: boolean;
  description: string;
  startup: string | null;
  startupSnapshot: string | null;
  recoveryCheckpoint: string | null;
  pendingInteraction: PendingInteraction | null;
  defaultGateway: string | null;
  domainName: string | null;
  nameServers: string[];
  enableSecretConfigured: boolean;
  passwordEncryption: boolean;
  users: Record<string, { privilege: number; secretConfigured: boolean }>;
  radiusServers: Record<string, RadiusServerState>;
  aaaNewModel: boolean;
  aaaLoginMethods: string[];
  aaaAuthorisationMethods: string[];
  aaaGroups: Record<string, string[]>;
  rsaKeyBits: number | null;
  sshVersion: number | null;
  lineSettings: Record<string, string[]>;
  /** Password material is never retained; only configured state is modelled. */
  linePasswordConfigured: Record<string, boolean>;
  dhcpExcluded: Array<{ start: string; end: string }>;
  dhcpPools: Record<string, DhcpPoolState>;
  aclEntries: Record<string, string[]>;
  ospfProcesses: Record<string, string[]>;
  execAliases: Record<string, string>;
  debugIpIcmp: boolean;
  terminalLength: number | null;
  appliedConfiguration: string[];
}

const newInterface = (name: string): InterfaceState => ({
  name,
  description: "",
  ipv4: null,
  mask: null,
  adminUp: false,
  carrierUp: true,
  encapsulationDot1q: null,
  switchportMode: null,
  accessVlan: null,
  voiceVlan: null,
  trunkNativeVlan: null,
  trunkAllowedVlans: [],
  portFast: false,
  bpduGuard: false,
  portSecurity: false,
  portSecurityMaximum: null,
  portSecurityViolation: null,
  channelGroup: null,
  channelMode: null,
  helperAddress: null,
  natRole: null,
  bandwidthKbps: null,
  loadIntervalSeconds: null,
  negotiationAuto: false,
  stormControlBroadcastLevel: null,
  udldPort: false,
  dhcpSnoopingRate: null,
  touched: false,
});

const cloneState = (state: DeviceState): DeviceState => JSON.parse(JSON.stringify(state)) as DeviceState;

const redactConfigurationText = (value: string): string => value.split("\n").map((line) => {
  const indentation = /^\s*/u.exec(line)?.[0] ?? "";
  return `${indentation}${redactCredentialText(line.slice(indentation.length))}`;
}).join("\n");

/**
 * Upgrade legacy in-memory snapshots without ever carrying line-password
 * values forward. Checkpoints are JSON strings inside DeviceState, so they are
 * sanitised recursively before the outer state can be serialised again.
 */
const sanitiseDeviceCredentials = (state: DeviceState, depth = 0): DeviceState => {
  state.lineSettings ??= {};
  state.linePasswordConfigured ??= {};
  for (const [line, settings] of Object.entries(state.lineSettings)) {
    let configured = state.linePasswordConfigured[line] === true;
    const safeSettings: string[] = [];
    for (const setting of settings) {
      if (/^password(?:\s|$)/iu.test(setting)) {
        if (/^password\s+\S+/iu.test(setting)) configured = true;
        continue;
      }
      safeSettings.push(redactCredentialText(setting));
    }
    state.lineSettings[line] = safeSettings;
    if (configured) state.linePasswordConfigured[line] = true;
    else delete state.linePasswordConfigured[line];
  }

  state.appliedConfiguration = (state.appliedConfiguration ?? []).map(redactCredentialText);
  if (state.startup !== null && state.startup !== undefined) {
    state.startup = redactConfigurationText(state.startup);
  }

  if (depth < 3) {
    for (const field of ["startupSnapshot", "recoveryCheckpoint"] as const) {
      const snapshot = state[field];
      if (!snapshot) continue;
      try {
        const restored = JSON.parse(snapshot) as DeviceState;
        state[field] = JSON.stringify(sanitiseDeviceCredentials(restored, depth + 1));
      } catch {
        // Do not retain arbitrary, potentially credential-bearing text in a
        // field that will itself be serialised as part of DeviceState.
        state[field] = null;
      }
    }
  }
  return state;
};

const legacyModeForContext = (context: CliContext): CliMode => {
  if (context === "subinterface" || context === "interface-range") return "interface";
  if (context === "acl-standard" || context === "acl-extended") return "acl";
  if (context === "radius" || context === "aaa-group") return "global";
  return context;
};

const syncCompatibilityFields = (state: DeviceState): DeviceState => {
  sanitiseDeviceCredentials(state);
  state.recoveryCheckpoint ??= null;
  for (const server of Object.values(state.radiusServers ?? {})) {
    server.administrativelyDisabled ??= false;
  }
  for (const item of Object.values(state.interfaces ?? {})) {
    item.bandwidthKbps ??= null;
    item.loadIntervalSeconds ??= null;
    item.negotiationAuto ??= false;
    item.stormControlBroadcastLevel ??= null;
    item.udldPort ??= false;
    item.dhcpSnoopingRate ??= null;
  }
  state.execAliases ??= {};
  state.debugIpIcmp ??= false;
  state.terminalLength ??= null;
  const selected = state.interfaces[state.selectedInterface];
  state.ipv4 = selected?.ipv4 ?? null;
  state.mask = selected?.mask ?? null;
  state.adminUp = selected?.adminUp ?? false;
  state.description = selected?.description ?? "";
  state.routes = state.staticRoutes.map((route) =>
    `ip route ${route.destination} ${route.mask} ${route.nextHop}${route.administrativeDistance === null ? "" : ` ${route.administrativeDistance}`}`);
  state.mode = legacyModeForContext(state.context);
  return state;
};

export const initialDevice = (profileId: DeviceProfileId = "router-ios-xe"): DeviceState => {
  const profile = getDeviceProfile(profileId);
  const selectedInterface = profileId === "router-ios-xe"
    ? "GigabitEthernet0/1"
    : "GigabitEthernet1/0/1";
  const interfaces = Object.fromEntries(profile.interfaces.map((name) => [name, newInterface(name)]));
  return syncCompatibilityFields({
    profileId,
    hostname: profile.hostname,
    mode: "user",
    context: "user",
    selectedInterface,
    selectedInterfaces: [selectedInterface],
    selectedVlan: null,
    selectedDhcpPool: null,
    selectedRadiusServer: null,
    selectedAaaGroup: null,
    selectedAcl: null,
    interfaces,
    vlans: {},
    staticRoutes: [],
    routes: [],
    ipv4: null,
    mask: null,
    adminUp: false,
    description: "",
    startup: null,
    startupSnapshot: null,
    recoveryCheckpoint: null,
    pendingInteraction: null,
    defaultGateway: null,
    domainName: null,
    nameServers: [],
    enableSecretConfigured: false,
    passwordEncryption: false,
    users: {},
    radiusServers: {},
    aaaNewModel: false,
    aaaLoginMethods: [],
    aaaAuthorisationMethods: [],
    aaaGroups: {},
    rsaKeyBits: null,
    sshVersion: null,
    lineSettings: {},
    linePasswordConfigured: {},
    dhcpExcluded: [],
    dhcpPools: {},
    aclEntries: {},
    ospfProcesses: {},
    execAliases: {},
    debugIpIcmp: false,
    terminalLength: null,
    appliedConfiguration: [],
  });
};

const deviceStateKeys = new Set<keyof DeviceState>([
  "profileId", "hostname", "mode", "context", "selectedInterface", "selectedInterfaces",
  "selectedVlan", "selectedDhcpPool", "selectedRadiusServer", "selectedAaaGroup", "selectedAcl",
  "interfaces", "vlans", "staticRoutes", "routes", "ipv4", "mask", "adminUp", "description",
  "startup", "startupSnapshot", "recoveryCheckpoint", "pendingInteraction", "defaultGateway",
  "domainName", "nameServers", "enableSecretConfigured", "passwordEncryption", "users",
  "radiusServers", "aaaNewModel", "aaaLoginMethods", "aaaAuthorisationMethods", "aaaGroups",
  "rsaKeyBits", "sshVersion", "lineSettings", "linePasswordConfigured", "dhcpExcluded",
  "dhcpPools", "aclEntries", "ospfProcesses", "execAliases", "debugIpIcmp", "terminalLength",
  "appliedConfiguration",
]);
const restoredCliModes = new Set<CliMode>([
  "user", "privileged", "global", "interface", "router", "line", "vlan", "acl", "dhcp",
]);

const isPlainDeviceRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const boundedDeviceRecord = (
  value: unknown,
  maximumEntries: number,
): value is Record<string, unknown> => isPlainDeviceRecord(value)
  && Object.keys(value).length <= maximumEntries;

const boundedDeviceString = (value: unknown, maximumLength = 512): value is string =>
  typeof value === "string" && value.length <= maximumLength;

const boundedDeviceStringArray = (
  value: unknown,
  maximumItems: number,
  maximumItemLength = 512,
): value is string[] => Array.isArray(value)
  && value.length <= maximumItems
  && value.every((item) => boundedDeviceString(item, maximumItemLength));

const nullableDeviceString = (value: unknown, maximumLength: number): boolean =>
  value === null || boundedDeviceString(value, maximumLength);

const nullableDeviceNumber = (value: unknown): boolean =>
  value === null || typeof value === "number" && Number.isFinite(value);

const safeDeviceName = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,63}$/u.test(value);

const safeLineIdentifier = (value: string): boolean => {
  if (value.length > 32) return false;
  const single = /^(?:console|aux) (\d{1,3})$/u.exec(value);
  if (single) return true;
  const vty = /^vty (\d{1,3})(?: (\d{1,3}))?$/u.exec(value);
  return Boolean(vty && (vty[2] === undefined || Number(vty[1]) <= Number(vty[2])));
};

const validDeviceStringArrayRecord = (
  value: unknown,
  maximumEntries: number,
  maximumItems: number,
  keyCheck: (key: string) => boolean = safeDeviceName,
): value is Record<string, string[]> => boundedDeviceRecord(value, maximumEntries)
  && Object.entries(value).every(([key, items]) =>
    keyCheck(key) && boundedDeviceStringArray(items, maximumItems));

const validLinePasswordRecord = (
  value: unknown,
  lineSettings: Readonly<Record<string, unknown>>,
): value is Record<string, boolean> => boundedDeviceRecord(value, 64)
  && Object.entries(value).every(([key, configured]) =>
    safeLineIdentifier(key) && Object.hasOwn(lineSettings, key) && typeof configured === "boolean");

const validRestoredInterface = (name: string, value: unknown): boolean => {
  if (!safeDeviceName(name) || !isPlainDeviceRecord(value) || value.name !== name) return false;
  return boundedDeviceString(value.description, 256)
    && nullableDeviceString(value.ipv4, 45) && nullableDeviceString(value.mask, 45)
    && typeof value.adminUp === "boolean" && typeof value.carrierUp === "boolean"
    && nullableDeviceNumber(value.encapsulationDot1q)
    && (value.switchportMode === null || value.switchportMode === "access" || value.switchportMode === "trunk")
    && nullableDeviceNumber(value.accessVlan) && nullableDeviceNumber(value.voiceVlan)
    && nullableDeviceNumber(value.trunkNativeVlan)
    && Array.isArray(value.trunkAllowedVlans) && value.trunkAllowedVlans.length <= 4094
    && value.trunkAllowedVlans.every((id) => Number.isInteger(id) && Number(id) >= 1 && Number(id) <= 4094)
    && typeof value.portFast === "boolean" && typeof value.bpduGuard === "boolean"
    && typeof value.portSecurity === "boolean" && nullableDeviceNumber(value.portSecurityMaximum)
    && nullableDeviceString(value.portSecurityViolation, 32)
    && nullableDeviceNumber(value.channelGroup) && nullableDeviceString(value.channelMode, 32)
    && nullableDeviceString(value.helperAddress, 45)
    && (value.natRole === null || value.natRole === "inside" || value.natRole === "outside")
    && nullableDeviceNumber(value.bandwidthKbps) && nullableDeviceNumber(value.loadIntervalSeconds)
    && typeof value.negotiationAuto === "boolean" && nullableDeviceString(value.stormControlBroadcastLevel, 32)
    && typeof value.udldPort === "boolean" && nullableDeviceNumber(value.dhcpSnoopingRate)
    && typeof value.touched === "boolean";
};

const validRestoredPendingInteraction = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isPlainDeviceRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "save") return value.destination === "startup-config";
  if (value.kind === "default-interface") {
    return boundedDeviceString(value.interfaceName, 64) && safeDeviceName(value.interfaceName);
  }
  return value.kind === "reload" || value.kind === "erase-startup";
};

const validRestoredDeviceShape = (value: Record<string, unknown>): boolean => {
  if (Object.keys(value).some((key) => !deviceStateKeys.has(key as keyof DeviceState))) return false;
  if (value.profileId !== "router-ios-xe" && value.profileId !== "catalyst-l2") return false;
  if (typeof value.hostname !== "string" || !/^[A-Za-z0-9-]{1,63}$/u.test(value.hostname)) return false;
  if (!Object.hasOwn(modeNames, String(value.context)) || !restoredCliModes.has(value.mode as CliMode)) return false;
  if (!boundedDeviceString(value.selectedInterface, 64) || !safeDeviceName(value.selectedInterface)) return false;
  if (!boundedDeviceRecord(value.interfaces, 128)
    || !Object.entries(value.interfaces).every(([name, item]) => validRestoredInterface(name, item))
    || !Object.hasOwn(value.interfaces, value.selectedInterface)) return false;
  if (isPlainDeviceRecord(value.pendingInteraction) && value.pendingInteraction.kind === "default-interface"
    && (typeof value.pendingInteraction.interfaceName !== "string"
      || !Object.hasOwn(value.interfaces, value.pendingInteraction.interfaceName))) return false;
  if (!boundedDeviceStringArray(value.selectedInterfaces, 64, 64)
    || value.selectedInterfaces.some((name) => !Object.hasOwn(value.interfaces as object, name))) return false;
  if (!(value.selectedVlan === null || Number.isInteger(value.selectedVlan)
    && Number(value.selectedVlan) >= 1 && Number(value.selectedVlan) <= 4094)) return false;
  for (const field of ["selectedDhcpPool", "selectedRadiusServer", "selectedAaaGroup", "selectedAcl"] as const) {
    if (!nullableDeviceString(value[field], 64)) return false;
  }

  if (!boundedDeviceRecord(value.vlans, 4094)
    || !Object.entries(value.vlans).every(([key, vlan]) => isPlainDeviceRecord(vlan)
      && Number.isInteger(vlan.id) && String(vlan.id) === key
      && boundedDeviceString(vlan.name, 64) && typeof vlan.active === "boolean")) return false;
  if (!Array.isArray(value.staticRoutes) || value.staticRoutes.length > 128
    || !value.staticRoutes.every((route) => isPlainDeviceRecord(route)
      && boundedDeviceString(route.destination, 45) && boundedDeviceString(route.mask, 45)
      && boundedDeviceString(route.nextHop, 45) && nullableDeviceNumber(route.administrativeDistance))) return false;
  if (!boundedDeviceStringArray(value.routes, 256)
    || !nullableDeviceString(value.ipv4, 45) || !nullableDeviceString(value.mask, 45)
    || typeof value.adminUp !== "boolean" || !boundedDeviceString(value.description, 256)) return false;
  if (!nullableDeviceString(value.startup, 131_072)
    || !nullableDeviceString(value.startupSnapshot, 262_144)
    || !nullableDeviceString(value.recoveryCheckpoint, 262_144)
    || !validRestoredPendingInteraction(value.pendingInteraction)) return false;
  if (!nullableDeviceString(value.defaultGateway, 45) || !nullableDeviceString(value.domainName, 255)
    || !boundedDeviceStringArray(value.nameServers, 16, 45)) return false;

  if (typeof value.enableSecretConfigured !== "boolean" || typeof value.passwordEncryption !== "boolean"
    || typeof value.aaaNewModel !== "boolean" || !nullableDeviceNumber(value.rsaKeyBits)
    || !nullableDeviceNumber(value.sshVersion)) return false;
  if (!boundedDeviceRecord(value.users, 64)
    || !Object.entries(value.users).every(([name, user]) => safeDeviceName(name) && isPlainDeviceRecord(user)
      && Number.isInteger(user.privilege) && Number(user.privilege) >= 0 && Number(user.privilege) <= 15
      && typeof user.secretConfigured === "boolean")) return false;
  if (!boundedDeviceRecord(value.radiusServers, 32)
    || !Object.entries(value.radiusServers).every(([name, server]) => safeDeviceName(name)
      && isPlainDeviceRecord(server) && server.name === name && nullableDeviceString(server.address, 45)
      && Number.isInteger(server.authenticationPort) && Number(server.authenticationPort) >= 1 && Number(server.authenticationPort) <= 65_535
      && Number.isInteger(server.accountingPort) && Number(server.accountingPort) >= 1 && Number(server.accountingPort) <= 65_535
      && typeof server.keyConfigured === "boolean" && typeof server.administrativelyDisabled === "boolean")) return false;
  if (!boundedDeviceStringArray(value.aaaLoginMethods, 32)
    || !boundedDeviceStringArray(value.aaaAuthorisationMethods, 32)
    || !validDeviceStringArrayRecord(value.aaaGroups, 32, 32)) return false;

  if (!validDeviceStringArrayRecord(value.lineSettings, 64, 256, safeLineIdentifier)
    || !validLinePasswordRecord(value.linePasswordConfigured, value.lineSettings as Record<string, unknown>)) return false;
  if (!Array.isArray(value.dhcpExcluded) || value.dhcpExcluded.length > 128
    || !value.dhcpExcluded.every((range) => isPlainDeviceRecord(range)
      && boundedDeviceString(range.start, 45) && boundedDeviceString(range.end, 45))) return false;
  if (!boundedDeviceRecord(value.dhcpPools, 64)
    || !Object.entries(value.dhcpPools).every(([name, pool]) => safeDeviceName(name) && isPlainDeviceRecord(pool)
      && pool.name === name && nullableDeviceString(pool.network, 45) && nullableDeviceString(pool.mask, 45)
      && nullableDeviceString(pool.defaultRouter, 45) && nullableDeviceString(pool.dnsServer, 45)
      && nullableDeviceString(pool.domainName, 255))) return false;
  if (!validDeviceStringArrayRecord(value.aclEntries, 128, 256)
    || !validDeviceStringArrayRecord(value.ospfProcesses, 64, 256)) return false;
  if (!boundedDeviceRecord(value.execAliases, 64)
    || !Object.entries(value.execAliases).every(([name, expansion]) => safeDeviceName(name)
      && boundedDeviceString(expansion, 256))) return false;
  return typeof value.debugIpIcmp === "boolean" && nullableDeviceNumber(value.terminalLength)
    && boundedDeviceStringArray(value.appliedConfiguration, 512);
};

const restoreDeviceStateAtDepth = (
  value: unknown,
  expectedProfileId: DeviceProfileId | undefined,
  depth: number,
): DeviceState | null => {
  try {
    if (!isPlainDeviceRecord(value)) return null;
    const serialised = JSON.stringify(value);
    if (serialised.length > 524_288) return null;
    const candidate = JSON.parse(serialised) as Record<string, unknown>;
    if (candidate.linePasswordConfigured === undefined) candidate.linePasswordConfigured = {};
    if (!validRestoredDeviceShape(candidate)) return null;
    if (expectedProfileId && candidate.profileId !== expectedProfileId) return null;

    if (depth >= 3 && (candidate.startupSnapshot !== null || candidate.recoveryCheckpoint !== null)) return null;
    for (const field of ["startupSnapshot", "recoveryCheckpoint"] as const) {
      const snapshot = candidate[field];
      if (typeof snapshot !== "string") continue;
      const restored = restoreDeviceStateAtDepth(JSON.parse(snapshot), candidate.profileId as DeviceProfileId, depth + 1);
      if (!restored) return null;
      candidate[field] = JSON.stringify(restored);
    }
    return syncCompatibilityFields(candidate as unknown as DeviceState);
  } catch {
    return null;
  }
};

/**
 * Validate, bound, clone and credential-sanitise a DeviceState restored from
 * browser or lab persistence. Unknown fields and malformed nested checkpoints
 * are rejected; legacy line-password strings migrate to configured booleans.
 */
export const restoreDeviceState = (
  value: unknown,
  expectedProfileId?: DeviceProfileId,
): DeviceState | null => restoreDeviceStateAtDepth(value, expectedProfileId, 0);

export const prepare = (state: DeviceState, command: Command): DeviceState => {
  const supportedProfiles = profileIdsForCommand(command);
  const targetProfile = command.deviceProfile
    ?? (supportedProfiles.length === 1 ? supportedProfiles[0] : state.profileId);
  const next = targetProfile === state.profileId
    ? cloneState(state)
    : initialDevice(targetProfile);

  if (command.mode === "line") {
    next.lineSettings["vty 0 4"] ??= [];
  } else if (command.mode === "router") {
    next.ospfProcesses["10"] ??= [];
  } else if (command.mode === "dhcp") {
    next.selectedDhcpPool = "USERS";
    next.dhcpPools.USERS ??= {
      name: "USERS",
      network: null,
      mask: null,
      defaultRouter: null,
      dnsServer: null,
      domainName: null,
    };
  } else if (command.mode === "acl") {
    next.selectedAcl = command.id.includes("standard") ? "MGMT" : "WEB-IN";
    next.aclEntries[next.selectedAcl] ??= [];
  } else if (command.mode === "vlan") {
    const vlanId = command.id.includes("management") ? 99 : 20;
    next.selectedVlan = vlanId;
    next.vlans[vlanId] ??= { id: vlanId, name: `VLAN${vlanId}`, active: command.id !== "vlan.state-active" };
  }

  const selected = next.interfaces[next.selectedInterface];
  if (selected && command.id === "interface.shutdown") {
    selected.touched = true;
    selected.adminUp = true;
  }
  if (selected && command.id === "interface.no-ip") {
    selected.touched = true;
    selected.ipv4 = "192.0.2.1";
    selected.mask = "255.255.255.0";
  }
  if (selected && ["tools.ping", "tools.traceroute", "verify.ping-source", "verify.traceroute-source"].includes(command.id)) {
    selected.touched = true;
    selected.adminUp = true;
    selected.ipv4 = command.id.startsWith("verify.") ? "192.0.2.1" : "192.0.2.2";
    selected.mask = "255.255.255.0";
    if (command.id.includes("traceroute") || command.id.startsWith("verify.")) {
      next.staticRoutes = [{
        destination: "0.0.0.0",
        mask: "0.0.0.0",
        nextHop: "192.0.2.254",
        administrativeDistance: null,
      }];
    }
  }
  if (command.id === "user.ssh") {
    next.users.netadmin = { privilege: 15, secretConfigured: true };
    next.aaaLoginMethods = ["aaa authentication login default group RAD-GRP local"];
  }
  if (command.id === "config.erase-startup" || command.id === "config.reload") {
    next.startup = runningConfig(next);
    next.startupSnapshot = snapshotForReload(next);
  }
  next.context = command.mode;
  return syncCompatibilityFields(next);
};

const promptSuffix: Record<CliContext, string> = {
  user: ">",
  privileged: "#",
  global: "(config)#",
  interface: "(config-if)#",
  subinterface: "(config-subif)#",
  "interface-range": "(config-if-range)#",
  router: "(config-router)#",
  line: "(config-line)#",
  vlan: "(config-vlan)#",
  acl: "(config-ext-nacl)#",
  "acl-standard": "(config-std-nacl)#",
  "acl-extended": "(config-ext-nacl)#",
  dhcp: "(dhcp-config)#",
  radius: "(config-radius-server)#",
  "aaa-group": "(config-sg-radius)#",
};

export const prompt = (state: DeviceState): string => `${state.hostname}${promptSuffix[state.context]}`;

const interfaceOperational = (state: DeviceState, item: InterfaceState): boolean => {
  if (!item.adminUp || !item.carrierUp) return false;
  const svi = /^Vlan(\d+)$/u.exec(item.name);
  if (!svi) return true;
  const vlan = state.vlans[svi[1]];
  if (!vlan?.active) return false;
  return Object.values(state.interfaces).some((candidate) =>
    candidate.name !== item.name
    && candidate.adminUp
    && candidate.carrierUp
    && (candidate.accessVlan === vlan.id
      || (candidate.switchportMode === "trunk" && candidate.trunkAllowedVlans.includes(vlan.id))));
};

const interfaceConfigLines = (item: InterfaceState): string[] => {
  const lines = [`interface ${item.name}`];
  if (item.description) lines.push(` description ${item.description}`);
  if (item.encapsulationDot1q !== null) lines.push(` encapsulation dot1Q ${item.encapsulationDot1q}`);
  if (item.ipv4 && item.mask) lines.push(` ip address ${item.ipv4} ${item.mask}`);
  if (item.switchportMode) lines.push(` switchport mode ${item.switchportMode}`);
  if (item.accessVlan !== null) lines.push(` switchport access vlan ${item.accessVlan}`);
  if (item.voiceVlan !== null) lines.push(` switchport voice vlan ${item.voiceVlan}`);
  if (item.trunkNativeVlan !== null) lines.push(` switchport trunk native vlan ${item.trunkNativeVlan}`);
  if (item.trunkAllowedVlans.length) lines.push(` switchport trunk allowed vlan ${item.trunkAllowedVlans.join(",")}`);
  if (item.portFast) lines.push(" spanning-tree portfast");
  if (item.bpduGuard) lines.push(" spanning-tree bpduguard enable");
  if (item.portSecurity) lines.push(" switchport port-security");
  if (item.portSecurityMaximum !== null) lines.push(` switchport port-security maximum ${item.portSecurityMaximum}`);
  if (item.portSecurityViolation) lines.push(` switchport port-security violation ${item.portSecurityViolation}`);
  if (item.channelGroup !== null) lines.push(` channel-group ${item.channelGroup} mode ${item.channelMode ?? "on"}`);
  if (item.helperAddress) lines.push(` ip helper-address ${item.helperAddress}`);
  if (item.natRole) lines.push(` ip nat ${item.natRole}`);
  if (item.bandwidthKbps !== null) lines.push(` bandwidth ${item.bandwidthKbps}`);
  if (item.loadIntervalSeconds !== null) lines.push(` load-interval ${item.loadIntervalSeconds}`);
  if (item.negotiationAuto) lines.push(" negotiation auto");
  if (item.stormControlBroadcastLevel) lines.push(` storm-control broadcast level ${item.stormControlBroadcastLevel}`);
  if (item.udldPort) lines.push(" udld port");
  if (item.dhcpSnoopingRate !== null) lines.push(` ip dhcp snooping limit rate ${item.dhcpSnoopingRate}`);
  lines.push(item.adminUp ? " no shutdown" : " shutdown");
  return lines;
};

export const runningConfig = (current: DeviceState): string => {
  const state = sanitiseDeviceCredentials(cloneState(current));
  const lines = [`hostname ${state.hostname}`];
  for (const [name, expansion] of Object.entries(state.execAliases)) lines.push(`alias exec ${name} ${expansion}`);
  if (state.enableSecretConfigured) lines.push("enable secret [configured]");
  if (state.passwordEncryption) lines.push("service password-encryption");
  for (const [username, value] of Object.entries(state.users)) {
    lines.push(`username ${username} privilege ${value.privilege} secret [configured]`);
  }
  if (state.domainName) lines.push(`ip domain name ${state.domainName}`);
  for (const server of state.nameServers) lines.push(`ip name-server ${server}`);
  if (state.aaaNewModel) lines.push("aaa new-model");
  for (const [group, servers] of Object.entries(state.aaaGroups)) {
    lines.push(`aaa group server radius ${group}`);
    for (const server of servers) lines.push(` server name ${server}`);
  }
  lines.push(...state.aaaLoginMethods, ...state.aaaAuthorisationMethods);
  if (state.sshVersion !== null) lines.push(`ip ssh version ${state.sshVersion}`);
  if (state.rsaKeyBits !== null) lines.push(`crypto key generate rsa modulus ${state.rsaKeyBits}`);
  for (const radius of Object.values(state.radiusServers)) {
    lines.push(`radius server ${radius.name}`);
    if (radius.address) lines.push(` address ipv4 ${radius.address} auth-port ${radius.authenticationPort} acct-port ${radius.accountingPort}`);
    if (radius.keyConfigured) lines.push(" key [configured]");
    if (radius.administrativelyDisabled) lines.push(" shutdown");
  }
  for (const exclusion of state.dhcpExcluded) lines.push(`ip dhcp excluded-address ${exclusion.start} ${exclusion.end}`);
  for (const pool of Object.values(state.dhcpPools)) {
    lines.push(`ip dhcp pool ${pool.name}`);
    if (pool.network && pool.mask) lines.push(` network ${pool.network} ${pool.mask}`);
    if (pool.defaultRouter) lines.push(` default-router ${pool.defaultRouter}`);
    if (pool.dnsServer) lines.push(` dns-server ${pool.dnsServer}`);
    if (pool.domainName) lines.push(` domain-name ${pool.domainName}`);
  }
  const configuredLines = new Set([
    ...Object.keys(state.lineSettings),
    ...Object.keys(state.linePasswordConfigured),
  ]);
  for (const line of configuredLines) {
    const settings = state.lineSettings[line] ?? [];
    lines.push(`line ${line}`);
    if (state.linePasswordConfigured[line]) lines.push(" password [redacted]");
    lines.push(...settings.map((setting) => ` ${setting}`));
  }
  for (const vlan of Object.values(state.vlans)) {
    lines.push(`vlan ${vlan.id}`);
    if (vlan.name) lines.push(` name ${vlan.name}`);
    if (!vlan.active) lines.push(" shutdown");
  }
  for (const item of Object.values(state.interfaces).filter((candidate) => candidate.touched)) {
    lines.push(...interfaceConfigLines(item));
  }
  lines.push(...state.routes);
  if (state.defaultGateway) lines.push(`ip default-gateway ${state.defaultGateway}`);
  lines.push(...state.appliedConfiguration, "end");
  return [...new Set(lines)].join("\n");
};

const snapshotForReload = (state: DeviceState): string => {
  const copy = cloneState(state);
  copy.pendingInteraction = null;
  copy.startupSnapshot = null;
  copy.recoveryCheckpoint = null;
  return JSON.stringify(copy);
};

const checkpointForRecovery = (state: DeviceState): string => {
  const copy = cloneState(state);
  copy.pendingInteraction = null;
  copy.recoveryCheckpoint = null;
  return JSON.stringify(copy);
};

const distinct = <T,>(left: readonly T[], right: readonly T[]): T[] =>
  [...new Set([...left, ...right])];

/**
 * IOS copies startup configuration into running configuration as a merge. A
 * line present in startup is applied, while unrelated unsaved running lines
 * are not implicitly removed. The simulator mirrors that distinction by
 * overlaying only state that differs from the profile baseline.
 */
const mergeStartupIntoRunning = (current: DeviceState, saved: DeviceState): DeviceState => {
  const result = cloneState(current);
  const baseline = initialDevice(current.profileId);

  if (saved.hostname !== baseline.hostname) result.hostname = saved.hostname;
  if (saved.defaultGateway !== null) result.defaultGateway = saved.defaultGateway;
  if (saved.domainName !== null) result.domainName = saved.domainName;
  if (saved.enableSecretConfigured) result.enableSecretConfigured = true;
  if (saved.passwordEncryption) result.passwordEncryption = true;
  if (saved.aaaNewModel) result.aaaNewModel = true;
  if (saved.rsaKeyBits !== null) result.rsaKeyBits = saved.rsaKeyBits;
  if (saved.sshVersion !== null) result.sshVersion = saved.sshVersion;

  result.nameServers = distinct(result.nameServers, saved.nameServers);
  result.aaaLoginMethods = distinct(result.aaaLoginMethods, saved.aaaLoginMethods);
  result.aaaAuthorisationMethods = distinct(result.aaaAuthorisationMethods, saved.aaaAuthorisationMethods);
  result.dhcpExcluded = distinct(
    result.dhcpExcluded.map((item) => JSON.stringify(item)),
    saved.dhcpExcluded.map((item) => JSON.stringify(item)),
  ).map((item) => JSON.parse(item) as { start: string; end: string });
  result.appliedConfiguration = distinct(result.appliedConfiguration, saved.appliedConfiguration);

  result.users = { ...result.users, ...cloneState(saved).users };
  result.radiusServers = { ...result.radiusServers, ...cloneState(saved).radiusServers };
  result.vlans = { ...result.vlans, ...cloneState(saved).vlans };
  result.dhcpPools = { ...result.dhcpPools, ...cloneState(saved).dhcpPools };
  result.execAliases = { ...result.execAliases, ...cloneState(saved).execAliases };

  for (const [group, servers] of Object.entries(saved.aaaGroups)) {
    result.aaaGroups[group] = distinct(result.aaaGroups[group] ?? [], servers);
  }
  for (const [line, settings] of Object.entries(saved.lineSettings)) {
    result.lineSettings[line] = distinct(result.lineSettings[line] ?? [], settings);
  }
  result.linePasswordConfigured = {
    ...result.linePasswordConfigured,
    ...cloneState(saved).linePasswordConfigured,
  };
  for (const [name, entries] of Object.entries(saved.aclEntries)) {
    result.aclEntries[name] = distinct(result.aclEntries[name] ?? [], entries);
  }
  for (const [process, settings] of Object.entries(saved.ospfProcesses)) {
    result.ospfProcesses[process] = distinct(result.ospfProcesses[process] ?? [], settings);
  }
  for (const route of saved.staticRoutes) {
    if (!result.staticRoutes.some((candidate) =>
      candidate.destination === route.destination
      && candidate.mask === route.mask
      && candidate.nextHop === route.nextHop
      && candidate.administrativeDistance === route.administrativeDistance)) {
      result.staticRoutes.push({ ...route });
    }
  }

  for (const [name, savedInterface] of Object.entries(saved.interfaces)) {
    if (!savedInterface.touched) continue;
    const target = result.interfaces[name] ?? newInterface(name);
    const defaultInterface = baseline.interfaces[name] ?? newInterface(name);
    const configurableKeys: Array<keyof InterfaceState> = [
      "description", "ipv4", "mask", "adminUp", "encapsulationDot1q",
      "switchportMode", "accessVlan", "voiceVlan", "trunkNativeVlan",
      "trunkAllowedVlans", "portFast", "bpduGuard", "portSecurity",
      "portSecurityMaximum", "portSecurityViolation", "channelGroup",
      "channelMode", "helperAddress", "natRole",
      "bandwidthKbps", "loadIntervalSeconds", "negotiationAuto",
      "stormControlBroadcastLevel", "udldPort", "dhcpSnoopingRate",
    ];
    for (const key of configurableKeys) {
      if (JSON.stringify(savedInterface[key]) !== JSON.stringify(defaultInterface[key])) {
        (target as unknown as Record<string, unknown>)[key] = JSON.parse(JSON.stringify(savedInterface[key])) as unknown;
      }
    }
    target.touched = true;
    result.interfaces[name] = target;
  }

  result.context = current.context;
  result.mode = current.mode;
  result.pendingInteraction = null;
  result.startup = current.startup;
  result.startupSnapshot = current.startupSnapshot;
  result.recoveryCheckpoint = current.recoveryCheckpoint;
  return syncCompatibilityFields(result);
};

const configurationDifferences = (state: DeviceState): string[] => {
  if (!state.startup) return ["% No startup configuration exists for comparison."];
  const saved = new Set(state.startup.split("\n"));
  const active = new Set(runningConfig(state).split("\n"));
  const removed = [...saved].filter((line) => !active.has(line)).map((line) => `- ${line}`);
  const added = [...active].filter((line) => !saved.has(line)).map((line) => `+ ${line}`);
  return removed.length || added.length
    ? ["Contextual Config Diffs:", ...removed, ...added]
    : ["Running configuration matches startup configuration."];
};

const setContext = (state: DeviceState, context: CliContext): void => {
  state.context = context;
  state.mode = legacyModeForContext(context);
};

const selectedInterfaceStates = (state: DeviceState): InterfaceState[] =>
  state.selectedInterfaces.map((name) => state.interfaces[name]).filter(Boolean);

const ensureSubinterface = (state: DeviceState, name: string): InterfaceState => {
  state.interfaces[name] ??= newInterface(name);
  return state.interfaces[name];
};

const showIpInterfaceBrief = (state: DeviceState): string[] => [
  "Interface                 IP-Address      Status                  Protocol",
  ...Object.values(state.interfaces)
    .filter((item) => item.touched || item.name === state.selectedInterface)
    .map((item) => {
      const operational = interfaceOperational(state, item);
      const status = item.adminUp ? (item.carrierUp ? "up" : "down") : "administratively down";
      return `${item.name.padEnd(25)} ${(item.ipv4 ?? "unassigned").padEnd(15)} ${status.padEnd(23)} ${operational ? "up" : "down"}`;
    }),
];

const prefixLength = (mask: string): number => mask.split(".")
  .map((octet) => Number(octet).toString(2).padStart(8, "0"))
  .join("").replace(/0/gu, "").length;

const showIpRoute = (state: DeviceState): string[] => {
  const connected = Object.values(state.interfaces)
    .filter((item) => item.ipv4 && item.mask && interfaceOperational(state, item))
    .map((item) => `C    ${item.ipv4}/${prefixLength(item.mask ?? "0.0.0.0")} is directly connected, ${item.name}`);
  const statics = state.staticRoutes.map((route) =>
    `${route.destination === "0.0.0.0" && route.mask === "0.0.0.0" ? "S*" : "S "}   ${route.destination}/${prefixLength(route.mask)} [1/0] via ${route.nextHop}`);
  return [
    "Codes: C - connected, S - static, * - candidate default",
    ...(statics.some((line) => line.startsWith("S*")) ? ["Gateway of last resort is configured"] : ["Gateway of last resort is not set"]),
    ...connected,
    ...statics,
  ];
};

const showVlans = (state: DeviceState): string[] => [
  "VLAN Name                             Status    Ports",
  ...Object.values(state.vlans).sort((a, b) => a.id - b.id).map((vlan) => {
    const ports = Object.values(state.interfaces).filter((item) => item.accessVlan === vlan.id).map((item) => item.name).join(", ");
    return `${String(vlan.id).padEnd(4)} ${vlan.name.padEnd(32)} ${vlan.active ? "active" : "suspended"}   ${ports}`;
  }),
];

const selectedOrNamedInterface = (state: DeviceState, event: ParsedCommandEvent): InterfaceState => {
  const requested = event.normalisedArguments.interface ?? event.arguments.interface;
  return (requested ? state.interfaces[requested] : undefined)
    ?? state.interfaces[state.selectedInterface]
    ?? Object.values(state.interfaces)[0];
};

const configuredLinesMatching = (state: DeviceState, pattern: RegExp): string[] =>
  runningConfig(state).split("\n").filter((line) => pattern.test(line.trim()));

/**
 * Every discoverable inspection production returns bounded deterministic
 * evidence. Empty operational tables are stated explicitly rather than
 * silently emitting no output or inventing live neighbours, users or faults.
 */
const inspectionOutput = (state: DeviceState, event: ParsedCommandEvent): string[] => {
  const item = selectedOrNamedInterface(state, event);
  const operational = item ? interfaceOperational(state, item) : false;
  const vlans = Object.values(state.vlans).sort((left, right) => left.id - right.id);
  const secured = Object.values(state.interfaces).filter((candidate) => candidate.portSecurity);
  const channelMembers = Object.values(state.interfaces).filter((candidate) => candidate.channelGroup !== null);
  const aclNames = Object.keys(state.aclEntries).sort();
  const ospf = Object.entries(state.ospfProcesses);
  const configuredNat = configuredLinesMatching(state, /^ip nat /iu);
  const configuredSnmp = configuredLinesMatching(state, /^snmp-server /iu);
  const configuredNtp = configuredLinesMatching(state, /^ntp /iu);
  const configuredLogging = configuredLinesMatching(state, /^logging /iu);
  const configuredSnooping = configuredLinesMatching(state, /^ip dhcp snooping/iu);
  const configuredInspection = configuredLinesMatching(state, /^ip arp inspection/iu);

  switch (event.command.id) {
    case "show.interfaces":
      return Object.values(state.interfaces)
        .filter((candidate) => candidate.touched || candidate.name === state.selectedInterface)
        .flatMap((candidate) => [
          `${candidate.name} is ${interfaceOperational(state, candidate) ? "up" : candidate.adminUp ? "down" : "administratively down"}, line protocol is ${interfaceOperational(state, candidate) ? "up" : "down"}`,
          `  Internet address is ${candidate.ipv4 && candidate.mask ? `${candidate.ipv4}/${prefixLength(candidate.mask)}` : "not configured"}`,
          `  Description: ${candidate.description || "not set"}`,
        ]);
    case "user.show-clock":
      return ["12:00:00.000 UTC Mon Jul 13 2026 (deterministic lab clock)"];
    case "show.clock-detail":
      return ["12:00:00.000 UTC Mon Jul 13 2026", "Time source is deterministic simulator clock; no NTP peer is authoritative."];
    case "user.show-history":
      return ["The browser terminal owns this session's bounded command history; use Up and Down to traverse it."];
    case "show.inventory":
      return [`NAME: “${state.hostname}”, DESCR: “${getDeviceProfile(state.profileId).label}”`, "PID: CLI-RUSH-LAB, VID: V01, SN: SIM00000001"];
    case "show.platform":
      return ["Chassis type: isolated educational simulator", "Slot  Type                 State", "0     Virtual supervisor   ready"];
    case "show.license-summary":
      return ["Licence usage is not emulated; no feature entitlement is required by this isolated simulator."];
    case "show.boot":
      return ["BOOT variable = packages.conf", `Next reload source = ${state.startupSnapshot ? "saved startup-config" : "no saved startup-config"}`];
    case "show.filesystems":
      return ["*  flash:   opaque   rw   simulated local storage", "   nvram:   opaque   rw   startup configuration storage"];
    case "show.flash":
      return ["Directory of flash:/", "  11  -rw-  4096  packages.conf", "No user files are stored in the isolated simulator."];
    case "show.archive":
      return [state.startupSnapshot ? "One saved startup checkpoint is available." : "No saved configuration checkpoint is available."];
    case "show.users":
      return ["Line       User       Host(s)              Idle", "* 0 con 0   learner    idle                 00:00:00"];
    case "show.sessions":
      return ["No outbound EXEC sessions are active in the isolated simulator."];
    case "show.login":
      return [state.aaaNewModel ? "AAA new-model is enabled." : "AAA new-model is not enabled.", `Local recovery users configured: ${Object.keys(state.users).length}`];
    case "show.logging":
      return configuredLogging.length
        ? ["Syslog logging: enabled", ...configuredLogging]
        : ["Syslog logging: console only; no remote logging destination configured."];
    case "show.ntp-status":
      return configuredNtp.length
        ? ["Clock is unsynchronised; configured NTP source has no simulated association.", ...configuredNtp]
        : ["Clock is unsynchronised; no NTP source is configured."];
    case "show.ntp-associations":
      return configuredNtp.length
        ? ["address         ref clock       st  when  poll reach delay offset disp", ...configuredNtp.map((line) => `~${line.split(" ").at(-1)}       .INIT.          16  -     64   0     0.0   0.0    0.0`)]
        : ["No NTP associations configured."];
    case "show.snmp":
      return configuredSnmp.length ? ["SNMP agent configuration:", ...configuredSnmp] : ["SNMP agent has no configured communities or destinations."];
    case "show.processes-cpu":
      return ["CPU utilisation for five seconds: 2%; one minute: 1%; five minutes: 1%", "PID Runtime(ms) Invoked  5Sec Process", "1   120         1200     0.10% Simulator"];
    case "show.processes-memory":
      return ["Processor Pool Total: 262144000 Used: 67108864 Free: 195035136", "PID TTY Allocated Freed Holding Process", "1   0   1048576   0     1048576 Simulator"];
    case "show.environment":
      return ["SYSTEM TEMPERATURE is OK", "SYSTEM POWER is OK", "No physical sensors are attached to this isolated simulator."];
    case "show.ip-arp": {
      const neighbours = [...new Set(state.staticRoutes.map((route) => route.nextHop))];
      return neighbours.length
        ? ["Protocol  Address          Age (min)  Hardware Addr   Type   Interface", ...neighbours.map((address, index) => `Internet  ${address.padEnd(15)}  0          0011.2233.${String(4400 + index)}  ARPA   ${state.selectedInterface}`)]
        : ["Protocol  Address          Age (min)  Hardware Addr   Type   Interface", "No dynamic ARP entries."];
    }
    case "show.ip-interface":
      return [
        `${item.name} is ${operational ? "up" : item.adminUp ? "down" : "administratively down"}, line protocol is ${operational ? "up" : "down"}`,
        `  Internet address is ${item.ipv4 && item.mask ? `${item.ipv4}/${prefixLength(item.mask)}` : "not configured"}`,
        `  Helper address is ${item.helperAddress ?? "not set"}`,
      ];
    case "show.interface-counters":
      return ["Port                      Align-Err  FCS-Err  Xmit-Err  Rcv-Err", ...Object.values(state.interfaces).filter((candidate) => candidate.touched || candidate.name === state.selectedInterface).map((candidate) => `${candidate.name.padEnd(25)} 0          0        0         0`)];
    case "show.interface-switchport":
      return [
        `Name: ${item.name}`,
        `Switchport: ${state.profileId === "catalyst-l2" ? "Enabled" : "Not applicable on the router profile"}`,
        `Administrative Mode: ${item.switchportMode ?? "dynamic auto"}`,
        `Access Mode VLAN: ${item.accessVlan ?? "not assigned"}`,
        `Voice VLAN: ${item.voiceVlan ?? "none"}`,
      ];
    case "show.interfaces-trunk": {
      const trunks = Object.values(state.interfaces).filter((candidate) => candidate.switchportMode === "trunk");
      return trunks.length
        ? ["Port                      Mode   Status    Native vlan  Allowed VLANs", ...trunks.map((candidate) => `${candidate.name.padEnd(25)} on     trunking  ${candidate.trunkNativeVlan ?? 1}            ${candidate.trunkAllowedVlans.join(",") || "all"}`)]
        : ["Port                      Mode   Status    Native vlan  Allowed VLANs", "No interfaces are trunking."];
    }
    case "show.mac-table":
    case "show.mac-dynamic": {
      const accessPorts = Object.values(state.interfaces).filter((candidate) => candidate.adminUp && candidate.accessVlan !== null);
      return accessPorts.length
        ? ["Vlan  Mac Address       Type       Ports", ...accessPorts.map((candidate, index) => `${String(candidate.accessVlan).padEnd(5)} 0011.2233.${String(4400 + index)} DYNAMIC    ${candidate.name}`)]
        : ["Vlan  Mac Address       Type       Ports", "No dynamic MAC addresses learned."];
    }
    case "show.spanning-tree":
    case "show.spanning-tree-vlan":
    case "show.spanning-tree-root":
      return vlans.length
        ? vlans.flatMap((vlan) => [`VLAN${String(vlan.id).padStart(4, "0")} Root ID priority ${32768 + vlan.id}`, "This bridge is the simulated root; no external bridge is attached."])
        : ["No active VLAN spanning-tree instances are configured."];
    case "show.etherchannel-summary":
    case "show.etherchannel-portchannel":
    case "show.lacp-neighbor":
    case "show.pagp-neighbor":
      return channelMembers.length
        ? ["Group  Port-channel  Protocol  Ports", ...channelMembers.map((candidate) => `${candidate.channelGroup}      Po${candidate.channelGroup}          ${(candidate.channelMode === "active" || candidate.channelMode === "passive") ? "LACP" : candidate.channelMode === "desirable" ? "PAgP" : "-"}      ${candidate.name}`)]
        : ["No EtherChannel members or negotiation neighbours are present."];
    case "show.cdp":
    case "show.cdp-detail":
    case "show.lldp-neighbors":
      return ["No discovery neighbours are present; the simulator does not invent an attached peer."];
    case "show.ip-protocols":
      return ospf.length
        ? ["Routing Protocol is “ospf”", ...ospf.map(([process, lines]) => `Process ${process}: ${lines.length} configured statement(s)`) ]
        : ["No dynamic IPv4 routing protocol is configured."];
    case "show.ip-ospf":
    case "show.ip-ospf-neighbor":
    case "show.ip-ospf-interface-brief":
    case "show.ip-ospf-database":
      return ospf.length
        ? ospf.flatMap(([process, lines]) => [`Routing Process “ospf ${process}”`, `${lines.length} process statement(s); no simulated neighbour adjacency is present.`])
        : ["OSPF is not configured; there are no neighbours, interfaces or LSAs to display."];
    case "show.ipv6-interface-brief":
    case "show.ipv6-route":
    case "show.ipv6-neighbors": {
      const ipv6 = configuredLinesMatching(state, /^(?:ipv6 |.*ipv6 )/iu);
      return ipv6.length ? ["IPv6 simulator configuration:", ...ipv6] : ["No IPv6 addresses, routes or neighbours are configured."];
    }
    case "show.access-lists":
    case "show.ip-access-lists":
    case "show.ipv6-access-list":
      return aclNames.length
        ? aclNames.flatMap((name) => [`IP access list ${name}`, ...(state.aclEntries[name].length ? state.aclEntries[name].map((entry) => `  ${entry}`) : ["  No entries configured."])])
        : ["No access lists are configured."];
    case "show.dhcp-conflict":
      return ["IP address        Detection method   Detection time", "No DHCP address conflicts recorded."];
    case "show.nat-translations":
      return configuredNat.length ? ["Pro  Inside global      Inside local       Outside local      Outside global", ...configuredNat] : ["No active NAT translations."];
    case "show.nat-statistics":
      return configuredNat.length ? [`${configuredNat.length} NAT rule(s) configured; 0 active translations.`] : ["NAT is not configured."];
    case "show.port-security":
    case "show.port-security-interface":
      return secured.length
        ? secured.map((candidate) => `${candidate.name}: Enabled, maximum ${candidate.portSecurityMaximum ?? 1}, violation ${candidate.portSecurityViolation ?? "shutdown"}`)
        : ["Port security is not enabled on any interface."];
    case "show.dhcp-snooping":
    case "show.dhcp-snooping-binding":
      return configuredSnooping.length ? ["DHCP snooping configuration:", ...configuredSnooping, "No dynamic bindings learned."] : ["DHCP snooping is not enabled."];
    case "show.arp-inspection":
      return configuredInspection.length ? ["Dynamic ARP inspection configuration:", ...configuredInspection] : ["Dynamic ARP inspection is not enabled."];
    case "show.hsrp-brief":
      return ["Interface   Grp Pri P State   Active          Standby         Virtual IP", "No standby groups are configured."];
    default:
      return [`${event.command.canonical}: no matching operational records in the current deterministic simulator state.`];
  }
};

const reachable = (state: DeviceState, target: string): boolean => {
  const upInterfaces = Object.values(state.interfaces).filter((item) =>
    item.ipv4 && item.mask && interfaceOperational(state, item));
  if (!upInterfaces.length) return false;
  if (upInterfaces.some((item) => item.ipv4 === target)) return true;
  const sameDocumentationSubnet = (left: string, right: string): boolean =>
    left.split(".").slice(0, 3).join(".") === right.split(".").slice(0, 3).join(".");
  if (upInterfaces.some((item) => sameDocumentationSubnet(item.ipv4 ?? "", target))) return true;
  return state.staticRoutes.some((route) =>
    (route.destination === "0.0.0.0" && route.mask === "0.0.0.0")
    || sameDocumentationSubnet(route.destination, target));
};

const addAppliedConfiguration = (state: DeviceState, event: ParsedCommandEvent): void => {
  const safe = redactCommandInput(event.input, event.context, commands, state.profileId);
  if (!state.appliedConfiguration.includes(safe)) state.appliedConfiguration.push(safe);
};

const applyEvent = (
  current: DeviceState,
  event: ParsedCommandEvent,
): { state: DeviceState; output: string[] } => {
  const state = syncCompatibilityFields(cloneState(current));
  const originalContext = current.context;
  const command = event.canonicalInput;
  const lowered = command.toLocaleLowerCase("en-GB");
  let output: string[] = [];

  if (lowered === "logout" || ((state.context === "user" || state.context === "privileged") && lowered === "exit")) {
    setContext(state, "user");
    output = ["EXEC session closed in the simulator; a fresh local training prompt is ready."];
  }
  else if (lowered === "enable") setContext(state, "privileged");
  else if (lowered === "disable") setContext(state, "user");
  else if (lowered === "configure terminal") setContext(state, "global");
  else if (lowered === "end") setContext(state, "privileged");
  else if (lowered === "exit") {
    if (state.context === "global") setContext(state, "privileged");
    else if (state.context !== "user" && state.context !== "privileged") setContext(state, "global");
  } else if (/^interface range /iu.test(command)) {
    const values = event.normalisedArguments.interfaceRange?.split(",")
      ?? parseInterfaceRange(command.replace(/^interface range /iu, ""), getDeviceProfile(state.profileId))
      ?? [];
    state.selectedInterfaces = values;
    if (values[0]) state.selectedInterface = values[0];
    setContext(state, "interface-range");
  } else if (/^interface /iu.test(command)) {
    const supplied = event.normalisedArguments.interface ?? command.replace(/^interface /iu, "");
    const name = normaliseInterfaceName(supplied, getDeviceProfile(state.profileId)) ?? supplied;
    const item = ensureSubinterface(state, name);
    item.touched = true;
    state.selectedInterface = name;
    state.selectedInterfaces = [name];
    setContext(state, name.includes(".") ? "subinterface" : "interface");
  } else if (/^router ospf /iu.test(command)) {
    const process = command.split(" ").at(-1) ?? "1";
    state.ospfProcesses[process] ??= [];
    setContext(state, "router");
  } else if (/^line /iu.test(command)) {
    const line = command.replace(/^line /iu, "");
    state.lineSettings[line] ??= [];
    state.linePasswordConfigured[line] ??= false;
    setContext(state, "line");
  } else if (/^vlan \d+$/iu.test(command)) {
    const id = Number(command.split(" ").at(-1));
    state.vlans[id] ??= { id, name: `VLAN${id}`, active: true };
    state.selectedVlan = id;
    setContext(state, "vlan");
  } else if (/^ip access-list (?:standard|extended) /iu.test(command)) {
    const type = / standard /iu.test(command) ? "acl-standard" : "acl-extended";
    const name = command.split(" ").at(-1) ?? "ACL";
    state.selectedAcl = name;
    state.aclEntries[name] ??= [];
    setContext(state, type);
  } else if (/^ip dhcp pool /iu.test(command)) {
    const name = command.split(" ").at(-1) ?? "POOL";
    state.selectedDhcpPool = name;
    state.dhcpPools[name] ??= { name, network: null, mask: null, defaultRouter: null, dnsServer: null, domainName: null };
    setContext(state, "dhcp");
  } else if (/^radius server /iu.test(command)) {
    const name = command.split(" ").at(-1) ?? "RADIUS";
    state.selectedRadiusServer = name;
    state.radiusServers[name] ??= { name, address: null, authenticationPort: 1812, accountingPort: 1813, keyConfigured: false, administrativelyDisabled: false };
    setContext(state, "radius");
  } else if (/^aaa group server radius /iu.test(command)) {
    state.selectedAaaGroup = command.split(" ").at(-1) ?? "RADIUS-GROUP";
    state.aaaGroups[state.selectedAaaGroup] ??= [];
    setContext(state, "aaa-group");
  } else if (/^hostname /iu.test(command)) state.hostname = command.slice(command.indexOf(" ") + 1);
  else if (/^alias exec /iu.test(command)) {
    const match = /^alias exec (\S+) (.+)$/iu.exec(command);
    if (match) state.execAliases[match[1]] = match[2];
  }
  else if (/^enable secret /iu.test(command)) state.enableSecretConfigured = true;
  else if (lowered === "service password-encryption") state.passwordEncryption = true;
  else if (lowered === "no service password-encryption") state.passwordEncryption = false;
  else if (/^username /iu.test(command)) {
    const match = /^username (\S+) privilege (\d+) secret /iu.exec(command);
    if (match) state.users[match[1]] = { privilege: Number(match[2]), secretConfigured: true };
  } else if (/^ip domain(?:-name| name) /iu.test(command)) state.domainName = command.split(" ").at(-1) ?? null;
  else if (/^ip name-server /iu.test(command)) {
    const address = command.split(" ").at(-1) ?? "";
    if (address && !state.nameServers.includes(address)) state.nameServers.push(address);
  } else if (lowered === "aaa new-model") state.aaaNewModel = true;
  else if (/^aaa authentication /iu.test(command)) state.aaaLoginMethods.push(command);
  else if (/^aaa authorization /iu.test(command)) state.aaaAuthorisationMethods.push(command);
  else if (/^crypto key generate rsa modulus /iu.test(command)) state.rsaKeyBits = Number(command.split(" ").at(-1));
  else if (/^ip ssh version /iu.test(command)) state.sshVersion = Number(command.split(" ").at(-1));
  else if (state.context === "radius" && /^address ipv4 /iu.test(command)) {
    const match = /^address ipv4 (\S+) auth-port (\d+) acct-port (\d+)$/iu.exec(command);
    const radius = state.selectedRadiusServer ? state.radiusServers[state.selectedRadiusServer] : null;
    if (match && radius) {
      radius.address = match[1];
      radius.authenticationPort = Number(match[2]);
      radius.accountingPort = Number(match[3]);
    }
  } else if (state.context === "radius" && /^key /iu.test(command)) {
    const radius = state.selectedRadiusServer ? state.radiusServers[state.selectedRadiusServer] : null;
    if (radius) radius.keyConfigured = true;
  } else if (state.context === "radius" && lowered === "shutdown") {
    const radius = state.selectedRadiusServer ? state.radiusServers[state.selectedRadiusServer] : null;
    if (radius) radius.administrativelyDisabled = true;
  } else if (state.context === "radius" && lowered === "no shutdown") {
    const radius = state.selectedRadiusServer ? state.radiusServers[state.selectedRadiusServer] : null;
    if (radius) radius.administrativelyDisabled = false;
  } else if (state.context === "aaa-group" && /^server name /iu.test(command)) {
    const group = state.selectedAaaGroup;
    const server = command.split(" ").at(-1) ?? "";
    if (group && server && !state.aaaGroups[group].includes(server)) state.aaaGroups[group].push(server);
  } else if (/^ip dhcp excluded-address /iu.test(command)) {
    const [, start = "", end = start] = command.split(" ").slice(2);
    if (start) state.dhcpExcluded.push({ start, end });
  } else if (state.context === "dhcp" && /^network /iu.test(command)) {
    const [, network, mask] = command.split(" ");
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) { pool.network = network; pool.mask = mask; }
  } else if (state.context === "dhcp" && /^default-router /iu.test(command)) {
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) pool.defaultRouter = command.split(" ").at(-1) ?? null;
  } else if (state.context === "dhcp" && /^dns-server /iu.test(command)) {
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) pool.dnsServer = command.split(" ").at(-1) ?? null;
  } else if (state.context === "dhcp" && /^domain-name /iu.test(command)) {
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) pool.domainName = command.split(" ").at(-1) ?? null;
  } else if (state.context === "dhcp" && /^no network /iu.test(command)) {
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) { pool.network = null; pool.mask = null; }
  } else if (state.context === "dhcp" && /^no default-router /iu.test(command)) {
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) pool.defaultRouter = null;
  } else if (state.context === "dhcp" && /^no dns-server /iu.test(command)) {
    const pool = state.selectedDhcpPool ? state.dhcpPools[state.selectedDhcpPool] : null;
    if (pool) pool.dnsServer = null;
  } else if (state.context === "vlan" && /^name /iu.test(command)) {
    const vlan = state.selectedVlan === null ? null : state.vlans[state.selectedVlan];
    if (vlan) vlan.name = command.replace(/^name /iu, "");
  } else if (state.context === "vlan" && lowered === "no name") {
    const vlan = state.selectedVlan === null ? null : state.vlans[state.selectedVlan];
    if (vlan) vlan.name = `VLAN${vlan.id}`;
  } else if (state.context === "vlan" && (lowered === "shutdown" || lowered === "no shutdown")) {
    const vlan = state.selectedVlan === null ? null : state.vlans[state.selectedVlan];
    if (vlan) vlan.active = lowered === "no shutdown";
  } else if (/^ip route /iu.test(command)) {
    const parts = command.split(" ");
    const route = { destination: parts[2], mask: parts[3], nextHop: parts[4], administrativeDistance: parts[5] ? Number(parts[5]) : null };
    const index = state.staticRoutes.findIndex((candidate) => candidate.destination === route.destination && candidate.mask === route.mask && candidate.nextHop === route.nextHop);
    if (index >= 0) state.staticRoutes[index] = route;
    else state.staticRoutes.push(route);
  } else if (/^no ip route /iu.test(command)) {
    const parts = command.split(" ");
    state.staticRoutes = state.staticRoutes.filter((route) =>
      !(route.destination === parts[3] && route.mask === parts[4] && route.nextHop === parts[5]));
  } else if (/^ip default-gateway /iu.test(command)) state.defaultGateway = command.split(" ").at(-1) ?? null;
  else if (/^default interface /iu.test(command)) {
    const supplied = event.normalisedArguments.interface ?? command.replace(/^default interface /iu, "");
    const name = normaliseInterfaceName(supplied, getDeviceProfile(state.profileId)) ?? supplied;
    state.recoveryCheckpoint = checkpointForRecovery(state);
    state.pendingInteraction = { kind: "default-interface", interfaceName: name };
    output = [`Defaulting ${name} removes all settings in that interface scope. Continue? [confirm]`];
  }
  else if (lowered === "configure replace nvram:startup-config force") {
    if (!state.startupSnapshot) {
      output = ["% Configuration replace stopped: no saved startup checkpoint exists."];
    } else {
      const savedStartup = state.startup;
      const savedSnapshot = state.startupSnapshot;
      const recoveryCheckpoint = checkpointForRecovery(state);
      const restored = restoreDeviceState(JSON.parse(savedSnapshot), state.profileId);
      if (!restored) output = ["% Configuration replace stopped: saved state failed validation."];
      else {
        Object.assign(state, restored, {
          startup: savedStartup,
          startupSnapshot: savedSnapshot,
          recoveryCheckpoint,
          pendingInteraction: null,
        });
        setContext(state, "privileged");
        output = ["Running configuration replaced from startup-config.", "Recovery checkpoint created for the previous unsaved running state."];
      }
    }
  }
  else if (/^copy running-config startup-config$/iu.test(command)) {
    state.pendingInteraction = { kind: "save", destination: "startup-config" };
    output = ["Destination filename [startup-config]?"];
  } else if (lowered === "copy startup-config running-config") {
    if (!state.startupSnapshot) output = ["% Copy stopped: startup-config is not present."];
    else {
      const saved = restoreDeviceState(JSON.parse(state.startupSnapshot), state.profileId);
      if (!saved) output = ["% Copy stopped: saved state failed validation."];
      else {
        const merged = mergeStartupIntoRunning(state, saved);
        Object.assign(state, merged);
        output = ["Startup configuration merged into running configuration.", "Unrelated unsaved running lines were not removed."];
      }
    }
  } else if (lowered === "write memory") {
    state.startup = runningConfig(state);
    state.startupSnapshot = snapshotForReload(state);
    output = ["Building configuration...", "[OK]"];
  } else if (lowered === "erase startup-config") {
    state.recoveryCheckpoint = checkpointForRecovery(state);
    state.pendingInteraction = { kind: "erase-startup" };
    output = ["Erasing startup configuration removes the saved recovery point. Continue? [confirm]"];
  } else if (lowered === "reload") {
    state.recoveryCheckpoint = checkpointForRecovery(state);
    state.pendingInteraction = { kind: "reload" };
    output = ["Proceed with reload? [confirm]"];
  } else if (lowered === "show archive config differences nvram:startup-config system:running-config") output = configurationDifferences(state);
  else if (lowered === "show running-config") output = runningConfig(state).split("\n");
  else if (lowered === "show startup-config") output = state.startup?.split("\n") ?? ["startup-config is not present in the simulator"];
  else if (lowered === "show ip interface brief") output = showIpInterfaceBrief(state);
  else if (lowered.startsWith("show ip route")) output = showIpRoute(state);
  else if (lowered === "show ip ssh") output = state.sshVersion === null
    ? ["SSH Disabled - no version configured"]
    : [`SSH Enabled - version ${state.sshVersion}.0`, `RSA key size: ${state.rsaKeyBits ?? "not generated"}`];
  else if (lowered === "show ssh") output = ["No active SSH sessions in the isolated simulator."];
  else if (lowered === "show aaa servers") output = Object.values(state.radiusServers).length
    ? Object.values(state.radiusServers).map((server) => `${server.name} ${server.address ?? "address not set"} State: ${server.administrativelyDisabled ? "DEAD (administratively disabled for the isolated exercise)" : server.address && server.keyConfigured ? "UP (simulated responses available)" : "INCOMPLETE"}; shared credential ${server.keyConfigured ? "present" : "missing"}`)
    : ["No RADIUS servers configured."];
  else if (lowered === "show arp") output = inspectionOutput(state, { ...event, command: { ...event.command, id: "show.ip-arp" } });
  else if (lowered === "show interfaces switchport") output = Object.values(state.interfaces)
    .filter((item) => item.touched)
    .flatMap((item) => [`Name: ${item.name}`, `Administrative Mode: ${item.switchportMode ?? "dynamic auto"}`, `Access Mode VLAN: ${item.accessVlan ?? "not assigned"}`, `Voice VLAN: ${item.voiceVlan ?? "none"}`]);
  else if (lowered === "show ip dhcp pool") output = Object.values(state.dhcpPools).length
    ? Object.values(state.dhcpPools).map((pool) => `Pool ${pool.name}: ${pool.network ?? "network not set"} ${pool.mask ?? ""}, default router ${pool.defaultRouter ?? "not set"}`)
    : ["No DHCP pools configured."];
  else if (lowered === "show ip dhcp binding") output = Object.values(state.dhcpPools).some((pool) => pool.network && pool.mask)
    ? ["Bindings from all pools not associated with VRF:", "192.168.10.21  0100.0000.0001  Automatic"]
    : ["No DHCP bindings."];
  else if (lowered === "show vlan brief") output = showVlans(state);
  else if (lowered === "show interfaces status") output = [
    "Port                      Status       Vlan       Duplex Speed",
    ...Object.values(state.interfaces).filter((item) => item.touched).map((item) => `${item.name.padEnd(25)} ${(interfaceOperational(state, item) ? "connected" : item.adminUp ? "notconnect" : "disabled").padEnd(12)} ${String(item.accessVlan ?? (item.switchportMode === "trunk" ? "trunk" : "--")).padEnd(10)} auto   auto`),
  ];
  else if (lowered === "show interfaces description") output = Object.values(state.interfaces).filter((item) => item.touched).map((item) => `${item.name.padEnd(25)} ${item.description || "--"}`);
  else if (lowered === "show interfaces trunk") output = Object.values(state.interfaces).filter((item) => item.switchportMode === "trunk").map((item) => `${item.name} trunking allowed ${item.trunkAllowedVlans.join(",") || "all"}`);
  else if (lowered === "show spanning-tree") output = Object.values(state.vlans).flatMap((vlan) => [
    `VLAN${String(vlan.id).padStart(4, "0")}`,
    ...Object.values(state.interfaces).filter((item) => item.accessVlan === vlan.id || item.trunkAllowedVlans.includes(vlan.id)).map((item) => `${item.name} Desg FWD${item.portFast ? " Edge" : ""}${item.bpduGuard ? " BpduGuard" : ""}`),
  ]);
  else if (lowered === "show port-security") output = Object.values(state.interfaces).filter((item) => item.portSecurity).map((item) => `${item.name} Enabled Maximum ${item.portSecurityMaximum ?? 1} Violation ${item.portSecurityViolation ?? "shutdown"}`);
  else if (lowered === "show etherchannel summary") output = Object.values(state.interfaces).filter((item) => item.channelGroup !== null).map((item) => `${item.channelGroup} Po${item.channelGroup} ${item.channelMode} ${item.name}`);
  else if (lowered === "show version") output = ["IOS XE educational simulator, Version 17.9", `${state.hostname} uptime is 3 days, 4 hours`];
  else if (lowered === "clear counters") output = ["Simulated interface counters cleared; configuration is unchanged."];
  else if (lowered === "debug ip icmp") {
    state.debugIpIcmp = true;
    output = ["ICMP packet debugging is on in the isolated simulator."];
  } else if (lowered === "undebug all") {
    state.debugIpIcmp = false;
    output = ["All possible debugging has been turned off."];
  } else if (/^terminal length /iu.test(command)) {
    state.terminalLength = Number(command.split(" ").at(-1));
    output = [`Terminal page length set to ${state.terminalLength}; this session setting is not saved.`];
  }
  else if (/^ping /iu.test(command)) {
    const target = command.split(" ")[1];
    const success = reachable(state, target);
    output = [success ? "!!!!!" : ".....", `Success rate is ${success ? "100" : "0"} percent (${success ? "5/5" : "0/5"})`];
  } else if (/^traceroute /iu.test(command)) {
    const target = command.split(" ")[1];
    output = reachable(state, target) ? ["1 192.0.2.254 1 ms", `2 ${target} 3 ms`] : ["1 * * *", "Trace incomplete: no matching route."];
  } else if (/^ssh -l /iu.test(command)) {
    const match = /^ssh -l (\S+) (\S+)$/iu.exec(command);
    const username = match?.[1] ?? "";
    const fallbackConfigured = state.aaaLoginMethods.some((method) => / group \S+ local$/iu.test(method));
    const groupedServers = new Set(Object.values(state.aaaGroups).flat());
    const centralAvailable = Object.values(state.radiusServers).some((server) =>
      groupedServers.has(server.name) && server.address && server.keyConfigured && !server.administrativelyDisabled);
    if (centralAvailable && !state.users[username]) {
      output = [`RADIUS server accepted central user ${username}.`, "Encrypted SSH session established in the isolated simulator."];
    } else if (!centralAvailable && state.users[username] && fallbackConfigured) {
      output = ["RADIUS server did not respond.", `Local fallback accepted ${username}.`, "Encrypted SSH session established in the isolated simulator."];
    } else {
      output = ["% Authentication failed; neither the available central method nor configured local fallback accepted this simulated login."];
    }
  } else if (["interface", "subinterface", "interface-range"].includes(state.context)) {
    const items = selectedInterfaceStates(state);
    for (const item of items) {
      item.touched = true;
      if (/^description /iu.test(command)) item.description = command.replace(/^description /iu, "");
      else if (lowered === "no description") item.description = "";
      else if (/^encapsulation dot1q \d+$/iu.test(command)) item.encapsulationDot1q = Number(command.split(" ").at(-1));
      else if (/^ip address /iu.test(command)) {
        const parts = command.split(" ");
        item.ipv4 = parts[2];
        item.mask = parts[3];
      } else if (lowered === "no ip address") { item.ipv4 = null; item.mask = null; }
      else if (lowered === "no shutdown") {
        item.adminUp = true;
        output.push(`%LINK-3-UPDOWN: Interface ${item.name} changed state to ${item.carrierUp ? "up" : "down"}`);
      } else if (lowered === "shutdown") item.adminUp = false;
      else if (/^switchport mode (access|trunk)$/iu.test(command)) item.switchportMode = command.split(" ").at(-1) as "access" | "trunk";
      else if (/^switchport access vlan /iu.test(command)) item.accessVlan = Number(command.split(" ").at(-1));
      else if (/^switchport voice vlan /iu.test(command)) item.voiceVlan = Number(command.split(" ").at(-1));
      else if (/^switchport trunk native vlan /iu.test(command)) item.trunkNativeVlan = Number(command.split(" ").at(-1));
      else if (/^switchport trunk allowed vlan /iu.test(command)) item.trunkAllowedVlans = (command.split(" ").at(-1) ?? "").split(",").map(Number);
      else if (lowered === "spanning-tree portfast") item.portFast = true;
      else if (lowered === "spanning-tree bpduguard enable") item.bpduGuard = true;
      else if (lowered === "switchport port-security") item.portSecurity = true;
      else if (/^switchport port-security maximum /iu.test(command)) item.portSecurityMaximum = Number(command.split(" ").at(-1));
      else if (/^switchport port-security violation /iu.test(command)) item.portSecurityViolation = command.split(" ").at(-1) ?? null;
      else if (/^channel-group /iu.test(command)) {
        const match = /^channel-group (\d+) mode (\S+)$/iu.exec(command);
        if (match) { item.channelGroup = Number(match[1]); item.channelMode = match[2]; }
      } else if (/^ip helper-address /iu.test(command)) item.helperAddress = command.split(" ").at(-1) ?? null;
      else if (lowered === "ip nat inside") item.natRole = "inside";
      else if (lowered === "ip nat outside") item.natRole = "outside";
      else if (/^bandwidth /iu.test(command)) item.bandwidthKbps = Number(command.split(" ").at(-1));
      else if (lowered === "no bandwidth") item.bandwidthKbps = null;
      else if (/^load-interval /iu.test(command)) item.loadIntervalSeconds = Number(command.split(" ").at(-1));
      else if (lowered === "no load-interval") item.loadIntervalSeconds = null;
      else if (lowered === "negotiation auto") item.negotiationAuto = true;
      else if (lowered === "no negotiation auto") item.negotiationAuto = false;
      else if (/^storm-control broadcast level /iu.test(command)) item.stormControlBroadcastLevel = command.split(" ").at(-1) ?? null;
      else if (lowered === "no storm-control broadcast") item.stormControlBroadcastLevel = null;
      else if (lowered === "udld port") item.udldPort = true;
      else if (lowered === "no udld port") item.udldPort = false;
      else if (/^ip dhcp snooping limit rate /iu.test(command)) item.dhcpSnoopingRate = Number(command.split(" ").at(-1));
      else if (lowered === "no ip dhcp snooping limit rate") item.dhcpSnoopingRate = null;
    }
  } else if (state.context === "line") {
    const line = Object.keys(state.lineSettings).at(-1) ?? "vty 0 4";
    const settings = state.lineSettings[line];
    if (lowered === "no password") {
      delete state.linePasswordConfigured[line];
    } else if (/^password\s+\S+/iu.test(command)) {
      // Retain only the semantic fact that a line password exists. Plaintext
      // never enters DeviceState, startup snapshots or show output.
      state.linePasswordConfigured[line] = true;
    } else if (/^no access-class /iu.test(command)) {
      const positive = command.replace(/^no /iu, "");
      state.lineSettings[line] = settings.filter((setting) => setting.toLocaleLowerCase("en-GB") !== positive.toLocaleLowerCase("en-GB"));
    } else if (/^no privilege level /iu.test(command)) {
      state.lineSettings[line] = settings.filter((setting) => !/^privilege level /iu.test(setting));
    } else if (!settings.includes(command)) settings.push(command);
  } else if (state.context === "acl-standard" || state.context === "acl-extended" || state.context === "acl") {
    if (state.selectedAcl && /^no \d+$/u.test(lowered)) {
      const sequence = lowered.slice(3);
      state.aclEntries[state.selectedAcl] = state.aclEntries[state.selectedAcl].filter((entry) => !entry.startsWith(`${sequence} `));
    } else if (state.selectedAcl && !state.aclEntries[state.selectedAcl].includes(command)) state.aclEntries[state.selectedAcl].push(command);
  } else if (state.context === "router") {
    const process = Object.keys(state.ospfProcesses).at(-1) ?? "10";
    state.ospfProcesses[process] ??= [];
    if (lowered === "no redistribute static subnets") {
      state.ospfProcesses[process] = state.ospfProcesses[process].filter((setting) => setting.toLocaleLowerCase("en-GB") !== "redistribute static subnets");
    } else if (!state.ospfProcesses[process].includes(command)) state.ospfProcesses[process].push(command);
  } else if (event.command.kind === "configuration") addAppliedConfiguration(state, event);

  if (event.command.kind === "verification"
    && (lowered.startsWith("show ") || event.command.id === "show.flash")
    && output.length === 0) {
    output = inspectionOutput(state, event);
  }

  if (event.usedDo) setContext(state, originalContext);
  return { state: syncCompatibilityFields(state), output };
};

export interface CliExecutionResult {
  accepted: boolean;
  state: DeviceState;
  output: string[];
  resolution?: CommandResolution;
  event?: ParsedCommandEvent;
}

export const submitCliInteraction = (
  current: DeviceState,
  raw: string,
): CliExecutionResult => {
  const state = syncCompatibilityFields(cloneState(current));
  const pending = state.pendingInteraction;
  if (!pending) return { accepted: false, state, output: ["% No confirmation is pending."] };
  const answer = normalise(raw).toLocaleLowerCase("en-GB");
  if (pending.kind === "save") {
    if (answer && answer !== pending.destination) {
      return { accepted: false, state, output: [`% Use ${pending.destination}, or press Enter to accept the default.`] };
    }
    state.pendingInteraction = null;
    state.startup = runningConfig(state);
    state.startupSnapshot = snapshotForReload(state);
    return { accepted: true, state, output: ["Building configuration...", "[OK]"] };
  }
  if (answer && answer !== "confirm" && answer !== "yes" && answer !== "y") {
    state.pendingInteraction = null;
    return { accepted: false, state: syncCompatibilityFields(state), output: ["% Confirmation declined; no state changed."] };
  }
  if (pending.kind === "default-interface") {
    const carrierUp = state.interfaces[pending.interfaceName]?.carrierUp ?? true;
    state.interfaces[pending.interfaceName] = { ...newInterface(pending.interfaceName), carrierUp, touched: true };
    state.selectedInterface = pending.interfaceName;
    state.selectedInterfaces = [pending.interfaceName];
    state.pendingInteraction = null;
    return {
      accepted: true,
      state: syncCompatibilityFields(state),
      output: [`Interface ${pending.interfaceName} reset to profile defaults.`, "Simulator recovery checkpoint retained."],
    };
  }
  if (pending.kind === "erase-startup") {
    state.pendingInteraction = null;
    state.startup = null;
    state.startupSnapshot = null;
    return { accepted: true, state, output: ["[OK] startup-config erased"] };
  }
  if (!state.startupSnapshot) {
    state.pendingInteraction = null;
    return { accepted: false, state, output: ["% Reload cancelled: no saved recovery configuration exists."] };
  }
  const restored = restoreDeviceState(JSON.parse(state.startupSnapshot), state.profileId);
  if (!restored) {
    state.pendingInteraction = null;
    return { accepted: false, state, output: ["% Reload cancelled: saved state failed validation."] };
  }
  const recoveryCheckpoint = state.recoveryCheckpoint;
  restored.startup = state.startup;
  restored.startupSnapshot = state.startupSnapshot;
  restored.pendingInteraction = null;
  restored.recoveryCheckpoint = recoveryCheckpoint;
  setContext(restored, "user");
  return { accepted: true, state: syncCompatibilityFields(restored), output: ["System configuration restored from startup-config."] };
};

/** Restore the guaranteed local checkpoint created before a broad replacement. */
export const restoreDeviceCheckpoint = (current: DeviceState): CliExecutionResult => {
  const safeCurrent = restoreDeviceState(current, current.profileId);
  if (!safeCurrent?.recoveryCheckpoint) {
    return {
      accepted: false,
      state: safeCurrent ?? initialDevice(current.profileId),
      output: ["% No recovery checkpoint is available."],
    };
  }
  try {
    const restored = restoreDeviceState(JSON.parse(safeCurrent.recoveryCheckpoint), safeCurrent.profileId);
    if (!restored) throw new Error("Invalid recovery checkpoint");
    restored.pendingInteraction = null;
    restored.recoveryCheckpoint = null;
    return {
      accepted: true,
      state: syncCompatibilityFields(restored),
      output: ["Previous running state restored from the simulator recovery checkpoint."],
    };
  } catch {
    return {
      accepted: false,
      state: safeCurrent,
      output: ["% Recovery checkpoint is invalid; no state changed."],
    };
  }
};

export const executeCliCommand = (
  current: DeviceState,
  raw: string,
  catalogue: readonly Command[] = commands,
): CliExecutionResult => {
  const state = syncCompatibilityFields(cloneState(current));
  if (state.pendingInteraction) return submitCliInteraction(state, raw);
  const resolution = resolveCommand(raw, state.context, catalogue, state.profileId);
  if (resolution.status !== "valid") {
    return { accepted: false, state: cloneState(state), output: [resolution.message], resolution };
  }
  const applied = applyEvent(state, resolution.event);
  return { accepted: true, ...applied, resolution, event: resolution.event };
};

/**
 * Decide whether an accepted simulator event produced the semantic outcome of
 * a learning task. The parser still owns syntax; this layer checks the parsed
 * arguments and resulting state so a state-equivalent declared alternative
 * (for example `write memory`) can satisfy a save task.
 */
export const executionSatisfiesLearningObjective = (
  expected: Command,
  before: DeviceState,
  execution: CliExecutionResult,
  catalogue: readonly Command[] = commands,
): boolean => {
  if (!execution.accepted) return false;
  const after = execution.state;
  const task = learningTaskFor(expected);
  let parsedExpectedMatch = false;
  if (execution.event) {
    const expectedParse = parseRegistryInput(
      registryFor(catalogue, before.profileId),
      expected.canonical,
      before.context,
    );
    parsedExpectedMatch = expectedParse.status === "valid"
      && expectedArgumentsMatch(execution.event, expectedParse.event);
  }

  const stateEffects: string[] = [];
  if (parsedExpectedMatch && expected.kind === "configuration" && after.pendingInteraction === null) {
    stateEffects.push(expected.id);
  }
  if (parsedExpectedMatch && expected.id === "config.enable-secret" && after.enableSecretConfigured) {
    stateEffects.push("enable-secret-set");
  }
  if (parsedExpectedMatch && expected.id === "config.password-encryption" && after.passwordEncryption) {
    stateEffects.push("legacy-password-obfuscation-enabled");
  }
  if (parsedExpectedMatch && expected.id === "interface.no-shutdown"
    && after.interfaces[after.selectedInterface]?.adminUp) {
    stateEffects.push("selected-interface-admin-up");
  }
  const submittedAlternative = execution.event
    ? task.acceptedSemanticAlternatives.some((alternative) =>
        normalise(alternative).toLocaleLowerCase("en-GB")
          === normalise(execution.event!.canonicalInput).toLocaleLowerCase("en-GB"))
    : false;
  const completedPendingSave = before.pendingInteraction?.kind === "save"
    && after.pendingInteraction === null;
  const completedPendingErase = before.pendingInteraction?.kind === "erase-startup"
    && after.pendingInteraction === null
    && after.startup === null;
  const completedPendingReload = before.pendingInteraction?.kind === "reload"
    && after.pendingInteraction === null
    && execution.output.some((line) => /restored from startup-config/iu.test(line));
  if (expected.id === "config.erase-startup" && completedPendingErase) {
    stateEffects.push("config.erase-startup");
  }
  if (expected.id === "config.reload" && completedPendingReload) {
    stateEffects.push("startup-snapshot-restored");
  }
  if (expected.id === "config.save"
    && (parsedExpectedMatch || submittedAlternative || completedPendingSave)
    && after.pendingInteraction === null
    && after.startup !== null
    && after.startup === runningConfig(after)) {
    stateEffects.push("startup-snapshot-equals-running");
  }

  const actualCommandId = execution.event
    ? parsedExpectedMatch || execution.event.command.id !== expected.id
      ? execution.event.command.id
      : "__objective-argument-mismatch__"
    : undefined;
  return learningTaskSatisfied(task, {
    commandId: actualCommandId,
    canonicalInput: execution.event?.canonicalInput,
    beforeContext: before.context,
    afterContext: after.context,
    output: execution.output,
    stateEffects,
  });
};

/** Compatibility adapter used by the existing practice orchestrator. */
export const applyCommand = (
  state: DeviceState,
  command: Command,
  catalogue: readonly Command[] = commands,
): { state: DeviceState; output: string[] } => {
  const resolution = resolveCommand(command.canonical, state.context, catalogue, state.profileId);
  if (resolution.status === "valid") return applyEvent(state, resolution.event);
  const registry = registryFor(catalogue, state.profileId);
  const production = registry.productions.find((candidate) => candidate.command.id === command.id);
  if (!production) return { state: cloneState(state), output: [] };
  const event: ParsedCommandEvent = {
    command,
    production,
    input: command.canonical,
    canonicalInput: command.canonical,
    context: state.context,
    normalisedArguments: {},
    arguments: {},
    usedDo: false,
  };
  return applyEvent(state, event);
};

export type CliControlKey = "ArrowUp" | "ArrowDown" | "Ctrl+A" | "Ctrl+E" | "Ctrl+U" | "Ctrl+W" | "Ctrl+C" | "Ctrl+Z" | "Ctrl+Shift+6";

export interface CliControlResult {
  state: DeviceState;
  draft: string;
  cursor: number;
  executed: boolean;
  output: string[];
  historyIndex?: number;
}

export const handleCliControl = (
  current: DeviceState,
  key: CliControlKey,
  draft: string,
  history: readonly string[] = [],
  historyIndex = history.length,
): CliControlResult => {
  if (key === "Ctrl+A") return { state: current, draft, cursor: 0, executed: false, output: [] };
  if (key === "Ctrl+E") return { state: current, draft, cursor: draft.length, executed: false, output: [] };
  if (key === "Ctrl+U") return { state: current, draft: "", cursor: 0, executed: false, output: [] };
  if (key === "Ctrl+W") {
    const trimmed = draft.trimEnd();
    const cut = trimmed.lastIndexOf(" ");
    const next = cut < 0 ? "" : `${trimmed.slice(0, cut + 1)}`;
    return { state: current, draft: next, cursor: next.length, executed: false, output: [] };
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const direction = key === "ArrowUp" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(history.length, historyIndex + direction));
    const next = nextIndex === history.length ? "" : history[nextIndex] ?? draft;
    return { state: current, draft: next, cursor: next.length, executed: false, output: [], historyIndex: nextIndex };
  }
  if (key === "Ctrl+Shift+6") {
    return { state: current, draft: "", cursor: 0, executed: false, output: ["^C", "% Operation interrupted."] };
  }
  if (key === "Ctrl+C") {
    const state = cloneState(current);
    if (state.context !== "user" && state.context !== "privileged") setContext(state, "privileged");
    return { state, draft: "", cursor: 0, executed: false, output: ["^C"] };
  }
  const execution = draft.trim()
    ? executeCliCommand(current, draft)
    : { accepted: true, state: cloneState(current), output: [] };
  const state = cloneState(execution.state);
  setContext(state, "privileged");
  return {
    state,
    draft: "",
    cursor: 0,
    executed: Boolean(draft.trim()) && execution.accepted,
    output: execution.output,
  };
};

export const seededOrder=(seed:number,catalogue:Command[]=commands)=>{const a=catalogue.map(x=>x.id);let v=seed||1;for(let i=a.length-1;i>0;i--){v=(v*1664525+1013904223)>>>0;const j=Math.floor((v/4294967296)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
