import {
  getDeviceProfile,
  normaliseInterfaceName,
  parseInterfaceRange,
  type DeviceProfile,
  type DeviceProfileId,
} from "./device-profiles.ts";

export type RegistryContext =
  | "user"
  | "privileged"
  | "global"
  | "interface"
  | "subinterface"
  | "interface-range"
  | "router"
  | "line"
  | "vlan"
  | "acl"
  | "acl-standard"
  | "acl-extended"
  | "dhcp"
  | "radius"
  | "aaa-group";

export interface RegistryCommand {
  id: string;
  mode: string;
  canonical: string;
  objective: string;
  explanation: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  kind: "navigation" | "verification" | "configuration";
  custom?: boolean;
  /** Explicit virtual-device scope. Built-ins without this field are inferred. */
  deviceProfile?: DeviceProfileId;
  caseSensitiveTokens?: readonly number[];
}

export type RegistryArgumentKind =
  | "ipv4"
  | "subnet-mask"
  | "wildcard-mask"
  | "interface"
  | "interface-range"
  | "vlan"
  | "vlan-list"
  | "number"
  | "secret"
  | "word"
  | "line";

export interface RegistryKeywordToken {
  kind: "keyword";
  source: string;
  display: string;
  description: string;
}

export interface RegistryArgumentToken {
  kind: "argument";
  source: string;
  display: string;
  description: string;
  name: string;
  argumentKind: RegistryArgumentKind;
  caseSensitive: boolean;
  rest?: boolean;
}

export type RegistryToken = RegistryKeywordToken | RegistryArgumentToken;

export interface CommandProduction {
  command: RegistryCommand;
  context: RegistryContext;
  tokens: readonly RegistryToken[];
  signature: string;
  profileIds: readonly DeviceProfileId[];
  aliases?: readonly string[];
  supplemental?: boolean;
}

export interface CommandRegistry {
  profile: DeviceProfile;
  productions: readonly CommandProduction[];
  commandIds: ReadonlySet<string>;
  /** Help may intentionally describe both training profiles when no device is selected. */
  allProfiles: boolean;
}

export interface ParsedCommandEvent {
  command: RegistryCommand;
  production: CommandProduction;
  input: string;
  canonicalInput: string;
  context: RegistryContext;
  normalisedArguments: Readonly<Record<string, string>>;
  arguments: Readonly<Record<string, string>>;
  usedDo: boolean;
}

export type RegistryParseResult =
  | { status: "valid"; input: string; event: ParsedCommandEvent }
  | { status: "ambiguous"; input: string; matches: readonly CommandProduction[]; message: string }
  | { status: "incomplete"; input: string; matches: readonly CommandProduction[]; message: string }
  | { status: "wrong-context"; input: string; matches: readonly CommandProduction[]; message: string }
  | { status: "invalid"; input: string; message: string; failingToken: number };

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");
const normalise = (value: string): string => value.trim().replace(/\s+/gu, " ");
const credentialTypePattern = /^(?:0|5|7|8|9)$/u;

/**
 * `key` is overloaded in IOS. It introduces credential material in RADIUS or
 * TACACS server configuration, but it is also part of non-secret PKI commands
 * such as `crypto key generate` and `show crypto key`. Keep that distinction
 * in one place so grammar inference and fallback redaction cannot disagree.
 */
type CredentialMarkerKind = "secret" | "password" | "community" | "key";

const keywordAbbreviation = (value: string, keyword: string, minimum: number): boolean =>
  value.length >= minimum && keyword.startsWith(value);

const isNonCredentialCryptoKeySyntax = (tokens: readonly string[], index: number): boolean => {
  const token = lower(tokens[index] ?? "");
  const previous = lower(tokens[index - 1] ?? "");
  if (!keywordAbbreviation(token, "key", 1) || !keywordAbbreviation(previous, "crypto", 2)) return false;

  const beforeCrypto = lower(tokens[index - 2] ?? "");
  const showPrefix = keywordAbbreviation(beforeCrypto, "show", 2)
    && (index === 2 || (index === 3 && lower(tokens[0] ?? "") === "do"));
  if (showPrefix) return true;

  const next = lower(tokens[index + 1] ?? "");
  return index === 1
    && (keywordAbbreviation(next, "generate", 1) || keywordAbbreviation(next, "zeroize", 1));
};

const credentialMarkerKind = (
  tokens: readonly string[],
  index: number,
): CredentialMarkerKind | null => {
  const token = lower(tokens[index] ?? "");
  if (token === "secret" || token === "password" || token === "community") return token;
  if (keywordAbbreviation(token, "key", 1) && isNonCredentialCryptoKeySyntax(tokens, index)) return null;
  // `key` is accepted from its first character in the relevant IOS grammars.
  // Treat every other key prefix conservatively, including malformed inline
  // RADIUS forms, because invalid input must be safe to display and persist.
  if (keywordAbbreviation(token, "key", 1)) return "key";

  // Invalid or wrong-context input cannot always reach the parsed-token path.
  // Recognise only abbreviations whose surrounding grammar identifies a
  // credential position; do not treat arbitrary words such as `security` or
  // `passive-interface` as credential markers.
  const previous = lower(tokens[index - 1] ?? "");
  const first = lower(tokens[0] ?? "");
  if (keywordAbbreviation(token, "secret", 1)) {
    if (keywordAbbreviation(previous, "enable", 1)) return "secret";
    if (index >= 2 && keywordAbbreviation(first, "username", 1)) return "secret";
  }
  if (index === 0 && keywordAbbreviation(token, "password", 1)) return "password";
  if (index > 0 && keywordAbbreviation(token, "community", 1)
    && keywordAbbreviation(previous, "snmp-server", 1)) return "community";
  return null;
};

const isCredentialMarker = (tokens: readonly string[], index: number): boolean =>
  credentialMarkerKind(tokens, index) !== null;

const keywordDescriptions: Readonly<Record<string, string>> = {
  aaa: "Configure authentication, authorisation and accounting",
  address: "Configure an address",
  alias: "Create a command alias",
  bandwidth: "Set the informational interface bandwidth",
  clear: "Clear bounded operational counters or state",
  configure: "Enter a configuration context",
  copy: "Copy configuration or file data",
  debug: "Enable focused diagnostic messages",
  default: "Restore a feature or interface to its default state",
  disable: "Return to User EXEC",
  do: "Run an EXEC command without leaving configuration",
  enable: "Raise the EXEC privilege level",
  end: "Return to Privileged EXEC",
  exit: "Leave the current context",
  hostname: "Set the device hostname",
  interface: "Select an interface or interface range",
  ip: "Use IPv4 features",
  line: "Configure terminal lines",
  no: "Remove or negate a setting",
  ping: "Test IP reachability",
  radius: "Configure a RADIUS server",
  reload: "Reload the device",
  router: "Configure a routing process",
  service: "Configure a system service",
  show: "Display operational information",
  shutdown: "Change administrative state",
  switchport: "Configure Layer 2 port behaviour",
  terminal: "Use the current terminal session",
  traceroute: "Trace a routed path",
  undebug: "Disable diagnostic messages",
  vlan: "Configure a virtual LAN",
  write: "Save the running configuration",
};

const keywordToken = (source: string): RegistryKeywordToken => ({
  kind: "keyword",
  source,
  display: source,
  description: keywordDescriptions[lower(source)] ?? "IOS XE command keyword",
});

const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/u;
const interfacePattern = /^(?:et|fa|gi|te|fo|hu|po|vl|ethernet|fastethernet|gigabitethernet|tengigabitethernet|fortygigabitethernet|hundredgige|port-?channel|vlan)\d+(?:\/\d+)*(?:\.\d+)?$/iu;
const numberPattern = /^\d+$/u;
const vlanListPattern = /^\d+(?:[,-]\d+)+$/u;

const isMask = (value: string, allowZero = false): boolean => {
  if (!ipv4Pattern.test(value)) return false;
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const bits = octets.map((octet) => octet.toString(2).padStart(8, "0")).join("");
  return (allowZero || bits.includes("1")) && /^1*0*$/u.test(bits);
};

const argument = (
  source: string,
  name: string,
  argumentKind: RegistryArgumentKind,
  display: string,
  description: string,
  caseSensitive = false,
  rest = false,
): RegistryArgumentToken => ({
  kind: "argument",
  source,
  display,
  description,
  name,
  argumentKind,
  caseSensitive,
  ...(rest ? { rest: true } : {}),
});

const inferIpv4Kind = (
  command: RegistryCommand,
  tokens: readonly string[],
  index: number,
): RegistryArgumentKind => {
  const before = tokens.slice(0, index).map(lower);
  const canonical = lower(command.canonical);
  if (before.includes("route") && before.filter((token) => ipv4Pattern.test(token)).length === 1) return "subnet-mask";
  if (before[0] === "network" && before.filter((token) => ipv4Pattern.test(token)).length === 1) {
    return command.mode === "router" || canonical.includes(" area ") ? "wildcard-mask" : "subnet-mask";
  }
  if (before.includes("address") && before.filter((token) => ipv4Pattern.test(token)).length === 1) return "subnet-mask";
  if (command.mode === "acl" || before.includes("access-list")) {
    return before.filter((token) => ipv4Pattern.test(token)).length % 2 === 1 ? "wildcard-mask" : "ipv4";
  }
  return "ipv4";
};

const ipv4ArgumentName = (tokens: readonly string[], index: number): string => {
  const before = tokens.slice(0, index).map(lower);
  const previous = before.at(-1) ?? "";
  const count = before.filter((token) => ipv4Pattern.test(token)).length;
  if (before.includes("route")) return ["destination", "mask", "nextHop"][count] ?? `address${count + 1}`;
  if (before.includes("address") && before[0] === "ip") return count === 0 ? "address" : "mask";
  if (before[0] === "network") return count === 0 ? "network" : "mask";
  if (before.includes("excluded-address")) return count === 0 ? "startAddress" : "endAddress";
  if (previous === "source") return "sourceAddress";
  if (previous === "default-gateway") return "gateway";
  if (previous === "default-router") return "defaultRouter";
  if (previous === "dns-server") return "dnsServer";
  if (previous === "helper-address") return "helperAddress";
  if (previous === "host" || previous === "server") return "serverAddress";
  return count === 0 ? "address" : `address${count + 1}`;
};

const inferTokens = (command: RegistryCommand): RegistryToken[] => {
  const sourceTokens = command.canonical.trim().split(/\s+/u).filter(Boolean);
  const result: RegistryToken[] = [];
  for (let index = 0; index < sourceTokens.length; index += 1) {
    const source = sourceTokens[index];
    const before = sourceTokens.slice(0, index).map(lower);
    const previous = before.at(-1) ?? "";
    const first = before[0] ?? lower(sourceTokens[0] ?? "");
    const previousIsCredentialMarker = isCredentialMarker(sourceTokens, index - 1);
    const previousIsCredentialType = credentialTypePattern.test(source)
      && previousIsCredentialMarker;
    const followsCredentialType = credentialTypePattern.test(previous)
      && isCredentialMarker(sourceTokens, index - 2);
    const explicitSensitive = command.caseSensitiveTokens?.includes(index)
      || (previousIsCredentialMarker && !previousIsCredentialType)
      || followsCredentialType;

    if (index === 1 && first === "description") {
      result.push(argument(sourceTokens.slice(index).join(" "), "description", "line", "LINE", "Interface description text", false, true));
      break;
    }
    if (index === 2 && first === "banner" && previous === "motd") {
      result.push(argument(sourceTokens.slice(index).join(" "), "banner", "line", "LINE", "Banner delimiter and message text", false, true));
      break;
    }
    if (ipv4Pattern.test(source)) {
      const kind = inferIpv4Kind(command, sourceTokens, index);
      const name = ipv4ArgumentName(sourceTokens, index);
      const description = kind === "subnet-mask"
        ? "IPv4 subnet mask"
        : kind === "wildcard-mask"
          ? "IPv4 wildcard mask"
          : before.includes("address") && name === "address"
            ? "IPv4 interface address"
            : "IPv4 address";
      result.push(argument(source, name, kind, "A.B.C.D", description));
      continue;
    }
    if (source.includes(":") && source !== "flash:") {
      result.push(argument(source, `ipv6${index}`, "word", source.includes("/") ? "X:X::X/<0-128>" : "X:X::X", "IPv6 address or prefix"));
      continue;
    }
    if (interfacePattern.test(source)) {
      result.push(argument(source, "interface", "interface", "INTERFACE", "Interface type and identifier"));
      continue;
    }
    if (vlanListPattern.test(source)) {
      result.push(argument(source, "vlanList", "vlan-list", "<vlan-list>", "VLAN identifiers"));
      continue;
    }
    if (numberPattern.test(source)) {
      const isVlan = previous === "vlan" || first === "vlan";
      const display = previous === "privilege" ? "<0-15>"
        : previous === "eq" ? "<0-65535>"
          : isVlan ? "<1-4094>" : "<number>";
      result.push(argument(source, isVlan ? "vlan" : `${previous || "number"}${index}`, isVlan ? "vlan" : "number", display, isVlan ? "VLAN identifier" : "Numeric value"));
      continue;
    }
    if (source === "flash:") {
      result.push(argument(source, "fileSystem", "word", "FILE-SYSTEM", "File-system name"));
      continue;
    }
    if (explicitSensitive) {
      result.push(argument(source, previous || `secret${index}`, "secret", "WORD", "Case-sensitive secret value", true));
      continue;
    }
    if ((first === "hostname" && index === 1) || (first === "username" && index === 1)) {
      result.push(argument(source, first, "word", "WORD", first === "hostname" ? "Device hostname" : "Username"));
      continue;
    }
    if (previous === "-l") {
      result.push(argument(source, "username", "word", "WORD", "Username"));
      continue;
    }
    if (first === "name" && index === 1) {
      result.push(argument(source, "vlanName", "word", "WORD", "VLAN name"));
      continue;
    }
    if (["server", "pool", "standard", "extended", "name", "domain-name", "location", "contact", "access-group", "traffic-filter"].includes(previous)
      || /[A-Z@#]/u.test(source)
      || source.includes(".")) {
      result.push(argument(source, previous || `value${index}`, "word", "WORD", "Configured name or value", explicitSensitive));
      continue;
    }
    result.push(keywordToken(source));
  }
  return result;
};

const signatureFor = (context: RegistryContext, tokens: readonly RegistryToken[]): string =>
  `${context}:${tokens.map((token) => token.kind === "keyword" ? `k:${lower(token.source)}` : `a:${token.argumentKind}`).join("/")}`;

const supplementalCommand = (
  id: string,
  mode: RegistryContext,
  canonical: string,
  kind: RegistryCommand["kind"],
  topic: string,
  profileIds: readonly DeviceProfileId[],
  aliases: readonly string[] = [],
): CommandProduction => {
  const command: RegistryCommand = {
    id,
    mode,
    canonical,
    objective: "Supported simulator command.",
    explanation: "This command is executable in the deterministic simulator.",
    topic,
    difficulty: 1,
    kind,
  };
  const tokens = inferTokens(command);
  return { command, context: mode, tokens, signature: signatureFor(mode, tokens), profileIds, aliases, supplemental: true };
};

const both = ["router-ios-xe", "catalyst-l2"] as const;
const routerOnly = ["router-ios-xe"] as const;
const switchOnly = ["catalyst-l2"] as const;

const supplementalProductions = (): CommandProduction[] => [
  supplementalCommand("sim.user-exit", "user", "exit", "navigation", "CLI navigation", both),
  supplementalCommand("sim.write", "privileged", "write memory", "configuration", "Configuration management", both, ["write", "wr"]),
  supplementalCommand("sim.copy-startup-running", "privileged", "copy startup-config running-config", "configuration", "Configuration management", both),
  supplementalCommand("sim.show-config-differences", "privileged", "show archive config differences nvram:startup-config system:running-config", "verification", "Configuration management", routerOnly),
  supplementalCommand("sim.configure-replace", "privileged", "configure replace nvram:startup-config force", "configuration", "Configuration management", routerOnly),
  supplementalCommand("sim.clear-counters", "privileged", "clear counters", "configuration", "Troubleshooting", both),
  supplementalCommand("sim.debug-ip-icmp", "privileged", "debug ip icmp", "configuration", "Troubleshooting", routerOnly),
  supplementalCommand("sim.undebug-all", "privileged", "undebug all", "configuration", "Troubleshooting", both),
  supplementalCommand("sim.terminal-length", "privileged", "terminal length 0", "configuration", "CLI and system", both),
  supplementalCommand("sim.privileged-exit", "privileged", "exit", "navigation", "CLI navigation", both),
  supplementalCommand("sim.show-arp", "privileged", "show arp", "verification", "Neighbour discovery", routerOnly),
  supplementalCommand("sim.show-interfaces-switchport", "privileged", "show interfaces switchport", "verification", "Layer 2 switching", switchOnly),
  supplementalCommand("sim.end-global", "global", "end", "navigation", "CLI navigation", both),
  supplementalCommand("sim.alias-exec", "global", "alias exec interfaces show ip interface brief", "configuration", "CLI and system", both),
  supplementalCommand("sim.default-interface-router", "global", "default interface GigabitEthernet0/0/1", "configuration", "Interface configuration", routerOnly),
  supplementalCommand("sim.default-interface-switch", "global", "default interface GigabitEthernet1/0/1", "configuration", "Interface configuration", switchOnly),
  supplementalCommand("sim.interface-router", "global", "interface GigabitEthernet0/0/1", "navigation", "CLI navigation", routerOnly),
  supplementalCommand("sim.interface-switch", "global", "interface GigabitEthernet1/0/1", "navigation", "CLI navigation", switchOnly),
  supplementalCommand("sim.interface-subinterface", "global", "interface GigabitEthernet0/0/1.20", "navigation", "CLI navigation", routerOnly),
  supplementalCommand("sim.interface-range", "global", "interface range GigabitEthernet1/0/1 - 4", "navigation", "CLI navigation", switchOnly),
  supplementalCommand("sim.interface-vlan", "global", "interface Vlan99", "navigation", "CLI navigation", switchOnly),
  supplementalCommand("sim.aaa-new-model", "global", "aaa new-model", "configuration", "Secure management", both),
  supplementalCommand("sim.radius-server", "global", "radius server RAD1", "navigation", "Secure management", both),
  supplementalCommand("sim.aaa-group", "global", "aaa group server radius RAD-GRP", "navigation", "Secure management", both),
  supplementalCommand("sim.aaa-authentication", "global", "aaa authentication login default group RAD-GRP local", "configuration", "Secure management", both),
  supplementalCommand("sim.aaa-authorisation", "global", "aaa authorization exec default group RAD-GRP local", "configuration", "Secure management", both),
  supplementalCommand("sim.ip-domain-name-spaced", "global", "ip domain name lab.example", "configuration", "Secure management", both),
  supplementalCommand("sim.ip-name-server", "global", "ip name-server 192.0.2.53", "configuration", "Monitoring services", both),
  supplementalCommand("sim.no-default-route", "global", "no ip route 0.0.0.0 0.0.0.0 192.0.2.254", "configuration", "Routing", routerOnly),
  supplementalCommand("sim.no-description", "interface", "no description", "configuration", "Interface configuration", both),
  supplementalCommand("sim.show-aaa-servers", "privileged", "show aaa servers", "verification", "Secure management", both),
  supplementalCommand("sim.show-interfaces-description", "privileged", "show interfaces description", "verification", "Interface verification", both),
  supplementalCommand("sim.radius-address", "radius", "address ipv4 192.0.2.10 auth-port 1812 acct-port 1813", "configuration", "Secure management", both),
  supplementalCommand("sim.radius-key", "radius", "key <shared-secret>", "configuration", "Secure management", both),
  supplementalCommand("sim.radius-shutdown", "radius", "shutdown", "configuration", "Secure management", both),
  supplementalCommand("sim.radius-no-shutdown", "radius", "no shutdown", "configuration", "Secure management", both),
  supplementalCommand("sim.radius-exit", "radius", "exit", "navigation", "CLI navigation", both),
  supplementalCommand("sim.radius-end", "radius", "end", "navigation", "CLI navigation", both),
  supplementalCommand("sim.aaa-group-server", "aaa-group", "server name RAD1", "configuration", "Secure management", both),
  supplementalCommand("sim.aaa-group-exit", "aaa-group", "exit", "navigation", "CLI navigation", both),
  supplementalCommand("sim.aaa-group-end", "aaa-group", "end", "navigation", "CLI navigation", both),
  supplementalCommand("sim.line-login-auth", "line", "login authentication default", "configuration", "Secure management", both),
  supplementalCommand("sim.line-access-class", "line", "access-class MGMT in", "configuration", "Access control", both),
  supplementalCommand("sim.line-password", "line", "password <line-password>", "configuration", "Secure management", both),
  supplementalCommand("sim.line-privilege", "line", "privilege level 15", "configuration", "Secure management", both),
  supplementalCommand("sim.line-no-access-class", "line", "no access-class MGMT in", "configuration", "Access control", both),
  supplementalCommand("sim.line-no-password", "line", "no password", "configuration", "Secure management", both),
  supplementalCommand("sim.line-no-privilege", "line", "no privilege level 15", "configuration", "Secure management", both),
  supplementalCommand("sim.interface-description", "interface", "description LAB LINK", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-bandwidth", "interface", "bandwidth 1000000", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-load-interval", "interface", "load-interval 30", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-negotiation", "interface", "negotiation auto", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-storm-control", "interface", "storm-control broadcast level 1.00", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.interface-udld", "interface", "udld port", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.interface-dhcp-rate", "interface", "ip dhcp snooping limit rate 15", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.interface-no-bandwidth", "interface", "no bandwidth", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-no-load-interval", "interface", "no load-interval", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-no-negotiation", "interface", "no negotiation auto", "configuration", "Interface configuration", both),
  supplementalCommand("sim.interface-no-storm-control", "interface", "no storm-control broadcast", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.interface-no-udld", "interface", "no udld port", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.interface-no-dhcp-rate", "interface", "no ip dhcp snooping limit rate", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.interface-description-range", "interface-range", "description LAB ACCESS PORTS", "configuration", "Interface configuration", switchOnly),
  supplementalCommand("sim.range-access", "interface-range", "switchport mode access", "configuration", "Layer 2 switching", switchOnly),
  supplementalCommand("sim.range-access-vlan", "interface-range", "switchport access vlan 10", "configuration", "Layer 2 switching", switchOnly),
  supplementalCommand("sim.range-voice-vlan", "interface-range", "switchport voice vlan 20", "configuration", "Layer 2 switching", switchOnly),
  supplementalCommand("sim.range-portfast", "interface-range", "spanning-tree portfast", "configuration", "Spanning Tree", switchOnly),
  supplementalCommand("sim.range-bpduguard", "interface-range", "spanning-tree bpduguard enable", "configuration", "Spanning Tree", switchOnly),
  supplementalCommand("sim.range-port-security", "interface-range", "switchport port-security", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.range-port-security-max", "interface-range", "switchport port-security maximum 2", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.range-port-security-restrict", "interface-range", "switchport port-security violation restrict", "configuration", "Switch security", switchOnly),
  supplementalCommand("sim.range-channel-group", "interface-range", "channel-group 1 mode active", "configuration", "EtherChannel", switchOnly),
  supplementalCommand("sim.range-no-shutdown", "interface-range", "no shutdown", "configuration", "Interface configuration", switchOnly),
  supplementalCommand("sim.range-shutdown", "interface-range", "shutdown", "configuration", "Interface configuration", switchOnly),
  supplementalCommand("sim.range-exit", "interface-range", "exit", "navigation", "CLI navigation", switchOnly),
  supplementalCommand("sim.range-end", "interface-range", "end", "navigation", "CLI navigation", switchOnly),
  supplementalCommand("sim.subif-encapsulation", "subinterface", "encapsulation dot1Q 20", "configuration", "Interface configuration", routerOnly),
  supplementalCommand("sim.subif-ip", "subinterface", "ip address 192.0.2.1 255.255.255.0", "configuration", "Interface configuration", routerOnly),
  supplementalCommand("sim.subif-description", "subinterface", "description VLAN 20 ROUTED LINK", "configuration", "Interface configuration", routerOnly),
  supplementalCommand("sim.subif-no-shutdown", "subinterface", "no shutdown", "configuration", "Interface configuration", routerOnly),
  supplementalCommand("sim.subif-shutdown", "subinterface", "shutdown", "configuration", "Interface configuration", routerOnly),
  supplementalCommand("sim.subif-exit", "subinterface", "exit", "navigation", "CLI navigation", routerOnly),
  supplementalCommand("sim.subif-end", "subinterface", "end", "navigation", "CLI navigation", routerOnly),
  supplementalCommand("sim.vlan-shutdown", "vlan", "shutdown", "configuration", "VLANs", switchOnly),
  supplementalCommand("sim.vlan-no-shutdown", "vlan", "no shutdown", "configuration", "VLANs", switchOnly),
  supplementalCommand("sim.vlan-no-name", "vlan", "no name", "configuration", "VLANs", switchOnly),
  supplementalCommand("sim.router-redistribute-static", "router", "redistribute static subnets", "configuration", "OSPF", routerOnly),
  supplementalCommand("sim.router-no-redistribute-static", "router", "no redistribute static subnets", "configuration", "OSPF", routerOnly),
  supplementalCommand("sim.dhcp-no-network", "dhcp", "no network 192.0.2.0 255.255.255.0", "configuration", "DHCP", routerOnly),
  supplementalCommand("sim.dhcp-no-default-router", "dhcp", "no default-router 192.0.2.254", "configuration", "DHCP", routerOnly),
  supplementalCommand("sim.dhcp-no-dns-server", "dhcp", "no dns-server 192.0.2.53", "configuration", "DHCP", routerOnly),
  supplementalCommand("sim.acl-sequence-permit", "acl-standard", "10 permit 192.0.2.0 0.0.0.255", "configuration", "Access control", both),
  supplementalCommand("sim.acl-remark", "acl-standard", "remark LAB MANAGEMENT SOURCES", "configuration", "Access control", both),
  supplementalCommand("sim.acl-no-sequence", "acl-standard", "no 10", "configuration", "Access control", both),
];

const withExplicitSupplementalGrammar = (production: CommandProduction): CommandProduction => {
  if (production.command.id !== "sim.interface-range") return production;
  const tokens: RegistryToken[] = [
    keywordToken("interface"),
    keywordToken("range"),
    argument(
      "GigabitEthernet1/0/1 - 4",
      "interfaceRange",
      "interface-range",
      "INTERFACE-RANGE",
      "Declared interface range",
      false,
      true,
    ),
  ];
  return { ...production, tokens, signature: signatureFor(production.context, tokens) };
};

export const profileIdsForCommand = (command: RegistryCommand): readonly DeviceProfileId[] => {
  if (command.deviceProfile) return [command.deviceProfile];
  const canonical = lower(command.canonical);
  const switching = command.topic === "Layer 2 switching"
    || command.topic === "VLANs"
    || command.topic === "Spanning Tree"
    || command.topic === "EtherChannel"
    || command.topic === "Switch security"
    || /(?:^|\s)switchport(?:\s|$)/u.test(canonical)
    || canonical.startsWith("vlan ");
  if (command.id === "config.default-gateway") return switchOnly;
  if (switching) return switchOnly;
  if (command.topic === "Routing" || command.topic === "OSPF" || command.topic === "NAT" || command.topic === "DHCP" || command.mode === "router" || command.mode === "dhcp") return routerOnly;
  return both;
};

export const buildCommandRegistry = (
  catalogue: readonly RegistryCommand[],
  profile: DeviceProfile = getDeviceProfile(),
  options: Readonly<{ includeSupplemental?: boolean; allProfiles?: boolean }> = {},
): CommandRegistry => {
  const catalogueProductions = catalogue.map((command): CommandProduction => {
    const context = command.mode as RegistryContext;
    const tokens = inferTokens(command);
    return {
      command,
      context,
      tokens,
      signature: signatureFor(context, tokens),
      profileIds: profileIdsForCommand(command),
    };
  });
  return {
    profile,
    productions: [
      ...catalogueProductions,
      ...(options.includeSupplemental === false
        ? []
        : supplementalProductions().map(withExplicitSupplementalGrammar)),
    ],
    commandIds: new Set(catalogue.map((command) => command.id)),
    allProfiles: options.allProfiles ?? false,
  };
};

const contextCompatible = (production: CommandProduction, context: RegistryContext): boolean => {
  if (production.context === context) return true;
  if (context === "privileged" && production.context === "user") {
    return production.command.id !== "nav.enable";
  }
  if (context === "subinterface") return production.context === "interface"
    && !lower(production.command.canonical).startsWith("switchport ");
  if (context === "interface-range") return production.context === "interface"
    && !/^(?:ip address|ipv6 address|standby |ip nat )/iu.test(production.command.canonical);
  if (context === "acl-standard" || context === "acl-extended") return production.context === "acl";
  return false;
};

const available = (production: CommandProduction, registry: CommandRegistry): boolean =>
  registry.allProfiles || production.profileIds.includes(registry.profile.id);

interface MatchResult {
  production: CommandProduction;
  arguments: Record<string, string>;
  normalisedArguments: Record<string, string>;
  canonicalInput: string;
  consumed: number;
}

const argumentValue = (
  token: RegistryArgumentToken,
  raw: string,
  profile: DeviceProfile,
): { accepted: boolean; normalised: string } => {
  const value = raw.trim();
  switch (token.argumentKind) {
    case "ipv4": {
      const octets = value.split(".");
      return { accepted: octets.length === 4 && octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255), normalised: value };
    }
    case "subnet-mask": return { accepted: isMask(value, token.source === "0.0.0.0"), normalised: value };
    case "wildcard-mask": {
      const octets = value.split(".");
      return {
        accepted: octets.length === 4 && octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255),
        normalised: value,
      };
    }
    case "interface": {
      const resolved = normaliseInterfaceName(value, profile);
      return { accepted: resolved !== null, normalised: resolved ?? value };
    }
    case "interface-range": {
      const range = parseInterfaceRange(value, profile);
      return { accepted: range !== null, normalised: range?.join(",") ?? value };
    }
    case "vlan": {
      const numeric = Number(value);
      return { accepted: Number.isInteger(numeric) && numeric >= 1 && numeric <= 4094, normalised: String(numeric) };
    }
    case "vlan-list": return { accepted: /^\d+(?:[,-]\d+)*$/u.test(value), normalised: value };
    case "number": return { accepted: /^\d+$/u.test(value), normalised: value };
    case "secret":
    case "word": return { accepted: /^\S+$/u.test(value), normalised: value };
    case "line": return { accepted: value.length > 0, normalised: value };
  }
};

const tokeniseInput = (input: string): string[] => normalise(input).split(" ").filter(Boolean);

const productionMatch = (
  production: CommandProduction,
  inputTokens: readonly string[],
  profile: DeviceProfile,
  allowIncomplete: boolean,
): MatchResult | null => {
  const args: Record<string, string> = {};
  const normalisedArgs: Record<string, string> = {};
  const canonical: string[] = [];
  let inputAt = 0;
  for (let tokenAt = 0; tokenAt < production.tokens.length; tokenAt += 1) {
    const token = production.tokens[tokenAt];
    if (inputAt >= inputTokens.length) return allowIncomplete
      ? { production, arguments: args, normalisedArguments: normalisedArgs, canonicalInput: canonical.join(" "), consumed: inputAt }
      : null;
    const raw = token.kind === "argument" && token.rest
      ? inputTokens.slice(inputAt).join(" ")
      : inputTokens[inputAt];
    if (token.kind === "keyword") {
      if (!lower(token.source).startsWith(lower(raw))) return null;
      canonical.push(token.source);
    } else {
      const checked = argumentValue(token, raw, profile);
      if (!checked.accepted) return null;
      args[token.name] = raw;
      normalisedArgs[token.name] = checked.normalised;
      canonical.push(checked.normalised);
    }
    inputAt += token.kind === "argument" && token.rest ? inputTokens.length - inputAt : 1;
  }
  if (inputAt !== inputTokens.length) return null;
  return { production, arguments: args, normalisedArguments: normalisedArgs, canonicalInput: canonical.join(" "), consumed: inputAt };
};

const exactKeywordPreference = (matches: MatchResult[], inputTokens: readonly string[]): MatchResult[] => {
  let narrowed = matches;
  for (let index = 0; index < inputTokens.length; index += 1) {
    const exact = narrowed.filter((match) => {
      const token = match.production.tokens[index];
      return token?.kind === "keyword" && lower(token.source) === lower(inputTokens[index]);
    });
    if (exact.length) narrowed = exact;
  }
  return narrowed;
};

const seedArgumentsMatch = (match: MatchResult): boolean => {
  for (const token of match.production.tokens) {
    if (token.kind !== "argument") continue;
    const actual = match.normalisedArguments[token.name];
    const expected = argumentValue(token, token.source, getDeviceProfile(match.production.profileIds[0] ?? "router-ios-xe")).normalised;
    if (token.caseSensitive ? actual !== expected : lower(actual ?? "") !== lower(expected)) return false;
  }
  return true;
};

const uniqueShapes = (matches: readonly MatchResult[]): Map<string, MatchResult[]> => {
  const shapes = new Map<string, MatchResult[]>();
  for (const match of matches) {
    // Compatible parent/subcontexts can expose the same grammar. Treat those
    // duplicates as one executable shape rather than a false ambiguity.
    const key = match.production.tokens
      .map((token) => token.kind === "keyword" ? `k:${lower(token.source)}` : `a:${token.argumentKind}`)
      .join("/");
    shapes.set(key, [...(shapes.get(key) ?? []), match]);
  }
  return shapes;
};

const contextLabel = (context: RegistryContext): string => ({
  user: "User EXEC",
  privileged: "Privileged EXEC",
  global: "Global Configuration",
  interface: "Interface Configuration",
  subinterface: "Router Subinterface Configuration",
  "interface-range": "Interface Range Configuration",
  router: "Router Configuration",
  line: "Line Configuration",
  vlan: "VLAN Configuration",
  acl: "Named ACL Configuration",
  "acl-standard": "Named Standard ACL Configuration",
  "acl-extended": "Named Extended ACL Configuration",
  dhcp: "DHCP Pool Configuration",
  radius: "RADIUS Server Configuration",
  "aaa-group": "AAA RADIUS Server-group Configuration",
})[context];

const aliasesFor = (registry: CommandRegistry, context: RegistryContext): Map<string, CommandProduction> => {
  const result = new Map<string, CommandProduction>();
  for (const production of registry.productions) {
    if (!available(production, registry) || !contextCompatible(production, context)) continue;
    for (const alias of production.aliases ?? []) result.set(lower(alias), production);
  }
  return result;
};

const normaliseInterfaceVlanSyntax = (input: string): string =>
  input.replace(/^interface\s+vlan\s+(\d+)$/iu, "interface Vlan$1");

const normaliseCompactRangeSyntax = (input: string, profile: DeviceProfile): string => {
  if (!profile.capabilities.compactInterfaceRanges) return input;
  return input.replace(/^(interface\s+range\s+)(\S+)-(\d+)$/iu, "$1$2 - $3");
};

const parseInContext = (
  registry: CommandRegistry,
  raw: string,
  context: RegistryContext,
): RegistryParseResult => {
  const input = normaliseCompactRangeSyntax(
    normaliseInterfaceVlanSyntax(normalise(raw)),
    registry.profile,
  );
  const aliases = aliasesFor(registry, context);
  const alias = aliases.get(lower(input));
  if (alias) {
    const event: ParsedCommandEvent = {
      command: alias.command,
      production: alias,
      input,
      canonicalInput: alias.command.canonical,
      context,
      normalisedArguments: {},
      arguments: {},
      usedDo: false,
    };
    return { status: "valid", input, event };
  }

  const tokens = tokeniseInput(input);
  const candidates = registry.productions.filter((production) =>
    available(production, registry) && contextCompatible(production, context));
  let matches = candidates
    .map((production) => productionMatch(production, tokens, registry.profile, false))
    .filter((match): match is MatchResult => match !== null);
  matches = exactKeywordPreference(matches, tokens);
  const shapes = uniqueShapes(matches);
  if (shapes.size === 1 && matches.length) {
    const seeded = matches.find(seedArgumentsMatch);
    const match = seeded ?? matches[0];
    return {
      status: "valid",
      input,
      event: {
        command: match.production.command,
        production: match.production,
        input,
        canonicalInput: match.canonicalInput,
        context,
        normalisedArguments: match.normalisedArguments,
        arguments: match.arguments,
        usedDo: false,
      },
    };
  }
  if (shapes.size > 1) {
    const productions = [...new Set(matches.map((match) => match.production))];
    return {
      status: "ambiguous",
      input,
      matches: productions,
      message: `% Ambiguous command: “${input}” (${productions.map((production) => production.command.canonical).sort().join(", ")})`,
    };
  }

  let incomplete = candidates
    .map((production) => productionMatch(production, tokens, registry.profile, true))
    .filter((match): match is MatchResult => match !== null && match.consumed === tokens.length && match.production.tokens.length > tokens.length);
  incomplete = exactKeywordPreference(incomplete, tokens);
  if (incomplete.length) {
    const lastIndex = Math.max(0, tokens.length - 1);
    const partial = tokens[lastIndex] ?? "";
    const keywordChoices = new Set(incomplete.flatMap((match) => {
      const token = match.production.tokens[lastIndex];
      return token?.kind === "keyword" && lower(token.source).startsWith(lower(partial)) ? [lower(token.source)] : [];
    }));
    if (keywordChoices.size > 1 && partial && !keywordChoices.has(lower(partial))) {
      return {
        status: "ambiguous",
        input,
        matches: [...new Set(incomplete.map((match) => match.production))],
        message: `% Ambiguous command: “${input}” (${[...keywordChoices].sort().join(", ")})`,
      };
    }
    return {
      status: "incomplete",
      input,
      matches: [...new Set(incomplete.map((match) => match.production))],
      message: "% Incomplete command.",
    };
  }

  const failingToken = Math.max(0, tokens.length - 1);
  const offset = tokens.slice(0, failingToken).reduce((sum, token) => sum + token.length + 1, 0);
  return {
    status: "invalid",
    input,
    failingToken,
    message: `${" ".repeat(offset)}^\n% Invalid input detected at '^' marker.`,
  };
};

export const parseRegistryInput = (
  registry: CommandRegistry,
  raw: string,
  context: RegistryContext,
): RegistryParseResult => {
  const input = normalise(raw);
  if (!input) return { status: "invalid", input, message: "Type a command before submitting.", failingToken: 0 };
  if (input.length > 256) return { status: "invalid", input, message: "The command exceeds the simulator limit.", failingToken: 0 };

  if (context !== "user" && context !== "privileged" && /^do\s+/iu.test(input)) {
    const nested = parseInContext(registry, input.replace(/^do\s+/iu, ""), "privileged");
    if (nested.status === "valid") {
      return {
        ...nested,
        input,
        event: { ...nested.event, input, context, usedDo: true },
      };
    }
    return nested;
  }

  const local = parseInContext(registry, input, context);
  if (local.status !== "invalid") return local;
  const contexts: RegistryContext[] = ["user", "privileged", "global", "interface", "subinterface", "interface-range", "router", "line", "vlan", "acl-standard", "acl-extended", "dhcp", "radius", "aaa-group"];
  for (const candidateContext of contexts) {
    if (candidateContext === context) continue;
    const elsewhere = parseInContext(registry, input, candidateContext);
    if (elsewhere.status === "valid") {
      return {
        status: "wrong-context",
        input,
        matches: [elsewhere.event.production],
        message: `That command is valid from ${contextLabel(candidateContext)}, not ${contextLabel(context)}.`,
      };
    }
  }
  return local;
};

export const grammarTokensForCommand = (command: RegistryCommand): RegistryToken[] =>
  inferTokens(command);

export const productionAvailableInContext = (
  registry: CommandRegistry,
  production: CommandProduction,
  context: RegistryContext,
): boolean => available(production, registry) && contextCompatible(production, context);

const redactedCredential = "[redacted]";
const safeCredentialSentinels = new Set([redactedCredential, "[configured]"]);

/**
 * Redact literal IOS credential tails even when the command is incomplete or
 * invalid. Numeric credential-type selectors are syntax rather than secret
 * material, so they remain visible when a value follows while every value
 * token after them is collapsed to one sentinel. A lone number is redacted
 * conservatively because it is also a valid one-token secret. SNMP's `ro`/`rw`
 * suffix is syntax and stays visible. This function deliberately does not
 * treat PKI `crypto key` forms as credentials.
 */
export const redactCredentialInput = (raw: string): string => {
  const input = normalise(raw);
  if (!input) return input;
  const words = input.split(" ");

  for (let index = 0; index < words.length; index += 1) {
    const marker = credentialMarkerKind(words, index);
    if (!marker) continue;
    const firstValue = index + 1;
    if (firstValue >= words.length) continue;

    const hasCredentialType = credentialTypePattern.test(words[firstValue]);
    const valueAt = hasCredentialType && firstValue + 1 < words.length ? firstValue + 1 : firstValue;
    if (marker === "community") {
      const terminal = ["ro", "rw"].includes(lower(words.at(-1) ?? "")) && words.length - 1 > valueAt
        ? words.at(-1)
        : null;
      const replacement = safeCredentialSentinels.has(lower(words[valueAt]))
        ? words[valueAt]
        : redactedCredential;
      words.splice(valueAt, words.length - valueAt, replacement, ...(terminal ? [terminal] : []));
      break;
    }

    if (safeCredentialSentinels.has(lower(words[valueAt]))) {
      words.splice(valueAt + 1);
      break;
    }
    words.splice(valueAt, words.length - valueAt, redactedCredential);
    break;
  }
  return words.join(" ");
};

/**
 * Redact case-sensitive credential arguments before terminal history, logs or
 * persistence receive command text. Invalid input receives a conservative
 * keyword-based fallback so a typo cannot bypass redaction.
 */
export const redactRegistryInput = (
  registry: CommandRegistry,
  raw: string,
  context: RegistryContext,
): string => {
  const parsed = parseRegistryInput(registry, raw, context);
  if (parsed.status !== "valid") return redactCredentialInput(raw);
  const words = normalise(raw).split(" ");
  const prefixOffset = parsed.event.usedDo ? 1 : 0;
  let wordAt = prefixOffset;
  for (const token of parsed.event.production.tokens) {
    if (token.kind === "argument" && token.caseSensitive) words[wordAt] = redactedCredential;
    if (token.kind === "argument" && token.rest) break;
    wordAt += 1;
  }
  return redactCredentialInput(words.join(" "));
};

export { parseInterfaceRange } from "./device-profiles.ts";
