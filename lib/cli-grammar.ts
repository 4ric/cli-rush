import type { Command } from "./engine.ts";

export type CliGrammarTokenKind = "keyword" | "argument";

export interface CliGrammarToken {
  /** The catalogue token used by deterministic matching. Never render this for arguments. */
  source: string;
  /** IOS-style text safe to render in context help. */
  display: string;
  description: string;
  kind: CliGrammarTokenKind;
}

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");

const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/u;
const ipv6Pattern = /:/u;
const interfacePattern = /^(?:ethernet|fastethernet|gigabitethernet|tengigabitethernet|twentyfivegige|fortygigabitethernet|hundredgige|port-channel|loopback|serial|tunnel|vlan)\d+(?:[/.:-]\d+)*$/iu;
const numberPattern = /^\d+$/u;
const vlanListPattern = /^\d+(?:,\d+)+$/u;

const keywordDescriptions: Readonly<Record<string, string>> = {
  show: "Display operational information",
  configure: "Enter a configuration context",
  terminal: "Use the current terminal session",
  interface: "Select or inspect an interface",
  interfaces: "Inspect interface state",
  brief: "Use a concise display",
  detail: "Include detailed information",
  status: "Display current status",
  counters: "Display packet or error counters",
  errors: "Restrict output to error counters",
  ip: "Use IPv4 features",
  ipv6: "Use IPv6 features",
  route: "Use routing information or configuration",
  address: "Configure a protocol address",
  arp: "Use the address resolution table",
  ospf: "Use Open Shortest Path First",
  network: "Specify a network",
  area: "Specify an OSPF area",
  vlan: "Use a virtual LAN",
  switchport: "Use Layer 2 switch-port settings",
  "spanning-tree": "Use Spanning Tree Protocol",
  "access-list": "Use an access-control list",
  "access-group": "Apply an access-control list",
  permit: "Allow matching traffic",
  deny: "Reject matching traffic",
  host: "Match one host address",
  any: "Match any address",
  tcp: "Match TCP traffic",
  udp: "Match UDP traffic",
  icmp: "Match ICMP traffic",
  eq: "Match an exact transport port",
  source: "Specify a source address or interface",
  no: "Remove or negate configuration",
  shutdown: "Change the administrative state",
  copy: "Copy configuration or file data",
  ping: "Send ICMP echo requests",
  traceroute: "Trace the routed path",
  router: "Enter a routing-process context",
  line: "Enter a terminal-line context",
  dhcp: "Use Dynamic Host Configuration Protocol",
  nat: "Use Network Address Translation",
  inside: "Use the inside NAT role",
  outside: "Use the outside NAT role",
  static: "Use a static entry",
  dynamic: "Use dynamically learned entries",
  default: "Use the default setting",
  logging: "Use system message logging",
  ntp: "Use Network Time Protocol",
  "snmp-server": "Configure the SNMP service",
  username: "Configure a local user",
  hostname: "Configure the device name",
  secret: "Supply a protected credential",
  privilege: "Specify an EXEC privilege level",
  description: "Add descriptive text",
  name: "Assign a configured name",
  exit: "Leave the current configuration level",
  end: "Return to privileged EXEC mode",
};

const keywordDescription = (token: string): string =>
  keywordDescriptions[lower(token)] ?? "IOS XE command keyword";

const ipv4Description = (
  command: Command,
  tokens: readonly string[],
  index: number,
): string => {
  const before = tokens.slice(0, index).map(lower);
  const earlierAddresses = tokens.slice(0, index).filter((token) => ipv4Pattern.test(token)).length;

  if (before.includes("host")) return "IPv4 host address";
  if (before.at(-1) === "source") return "IPv4 source address";
  if (before.at(-1) === "helper-address") return "IPv4 helper address";
  if (before.at(-1) === "default-router") return "IPv4 default-router address";
  if (before.at(-1) === "dns-server") return "IPv4 DNS-server address";
  if (before.at(-1) === "server" || before.at(-1) === "host") return "IPv4 server address";
  if (before.at(-1) === "default-gateway") return "IPv4 default-gateway address";
  if (before.includes("route")) {
    if (earlierAddresses === 0) return "IPv4 destination network";
    if (earlierAddresses === 1) return "IPv4 subnet mask";
    return "IPv4 next-hop address";
  }
  if (before.includes("address")) {
    return earlierAddresses === 0 ? "IPv4 interface address" : "IPv4 subnet mask";
  }
  if (before[0] === "network") {
    if (earlierAddresses === 0) return "IPv4 network address";
    return command.mode === "router" ? "IPv4 wildcard mask" : "IPv4 subnet mask";
  }
  if (command.mode === "acl" || before.includes("access-list")) {
    return earlierAddresses === 0 ? "IPv4 address or network" : "IPv4 wildcard mask or address";
  }
  if (before.includes("excluded-address")) return "IPv4 address in the excluded range";
  return "IPv4 address";
};

const numberArgument = (
  tokens: readonly string[],
  index: number,
): Pick<CliGrammarToken, "display" | "description"> => {
  const before = tokens.slice(0, index).map(lower);
  const previous = before.at(-1) ?? "";
  const first = before[0] ?? "";

  if (previous === "vlan" || first === "vlan") {
    return { display: "<1-4094>", description: "VLAN identifier" };
  }
  if (previous === "privilege") {
    return { display: "<0-15>", description: "EXEC privilege level" };
  }
  if (previous === "eq") {
    return { display: "<0-65535>", description: "TCP or UDP port number" };
  }
  if (previous === "area") {
    return { display: "<0-4294967295>", description: "OSPF area identifier" };
  }
  if (previous === "priority") {
    return { display: "<0-255>", description: "Protocol priority" };
  }
  if (previous === "standby") {
    return { display: "<0-255>", description: "HSRP group number" };
  }
  if (previous === "channel-group") {
    return { display: "<1-255>", description: "EtherChannel group number" };
  }
  if (previous === "version") {
    return { display: "<1-2>", description: "Protocol version" };
  }
  if (previous === "modulus") {
    return { display: "<key-size>", description: "RSA key size in bits" };
  }
  if (before.length >= 2 && before.at(-2) === "router" && previous === "ospf") {
    return { display: "<1-65535>", description: "OSPF process identifier" };
  }
  if (before.includes("line")) {
    return { display: "<line-number>", description: "Terminal line number" };
  }
  return { display: "<number>", description: "Numeric command value" };
};

const wordArgument = (
  tokens: readonly string[],
  index: number,
): Pick<CliGrammarToken, "display" | "description"> | null => {
  const before = tokens.slice(0, index).map(lower);
  const previous = before.at(-1) ?? "";
  const first = before[0] ?? "";

  if (first === "description") {
    return { display: "WORD", description: "Interface description text" };
  }
  if (first === "hostname" && index === 1) {
    return { display: "WORD", description: "Device hostname" };
  }
  if ((first === "username" && index === 1) || previous === "-l") {
    return { display: "WORD", description: "Username" };
  }
  if (previous === "secret") {
    return { display: "WORD", description: "Secret value" };
  }
  if (previous === "domain-name") {
    return { display: "WORD", description: "Domain name" };
  }
  if (before[0] === "banner" && before[1] === "motd") {
    return { display: "LINE", description: "Banner delimiter and message text" };
  }
  if (previous === "community") {
    return { display: "WORD", description: "SNMP community string" };
  }
  if (previous === "location") {
    return { display: "WORD", description: "SNMP location text" };
  }
  if (previous === "contact") {
    return { display: "WORD", description: "SNMP contact text" };
  }
  if (previous === "standard" || previous === "extended" || previous === "access-group" || previous === "traffic-filter") {
    return { display: "WORD", description: "Access-list name" };
  }
  if (previous === "pool") {
    return { display: "WORD", description: "DHCP pool name" };
  }
  if (first === "name") {
    return { display: "WORD", description: "VLAN name" };
  }
  return null;
};

const argumentToken = (
  command: Command,
  tokens: readonly string[],
  index: number,
): CliGrammarToken | null => {
  const source = tokens[index];
  if (ipv4Pattern.test(source)) {
    return {
      source,
      display: "A.B.C.D",
      description: ipv4Description(command, tokens, index),
      kind: "argument",
    };
  }
  if (ipv6Pattern.test(source) && source !== "flash:") {
    return {
      source,
      display: source.includes("/") ? "X:X::X/<0-128>" : "X:X::X",
      description: source.includes("/") ? "IPv6 prefix and prefix length" : "IPv6 address",
      kind: "argument",
    };
  }
  if (interfacePattern.test(source)) {
    return {
      source,
      display: "INTERFACE",
      description: "Interface type and identifier",
      kind: "argument",
    };
  }
  if (vlanListPattern.test(source)) {
    return {
      source,
      display: "<vlan-list>",
      description: "Comma-separated VLAN identifiers",
      kind: "argument",
    };
  }
  if (numberPattern.test(source)) {
    return { source, ...numberArgument(tokens, index), kind: "argument" };
  }
  if (source === "flash:") {
    return {
      source,
      display: "FILE-SYSTEM",
      description: "File-system name",
      kind: "argument",
    };
  }

  const contextualWord = wordArgument(tokens, index);
  if (contextualWord) return { source, ...contextualWord, kind: "argument" };

  // Built-in configured names and text use visible casing or value punctuation.
  // Mask them even if a future catalogue entry is not covered by a context rule.
  if (/[A-Z@#]/u.test(source) || source.includes(".")) {
    return {
      source,
      display: "WORD",
      description: "Configured name or value",
      kind: "argument",
    };
  }
  return null;
};

export const commandGrammarTokens = (command: Command): CliGrammarToken[] => {
  const tokens = command.canonical.trim().split(/\s+/u).filter(Boolean);
  return tokens.map((source, index) => argumentToken(command, tokens, index) ?? {
    source,
    display: source,
    description: keywordDescription(source),
    kind: "keyword",
  });
};

/** Match a typed token against a deterministic keyword or argument grammar node. */
export const grammarTokenMatches = (
  token: CliGrammarToken,
  typed: string,
): boolean => {
  if (!typed) return false;
  if (token.kind === "keyword") return lower(token.source).startsWith(lower(typed));

  if (token.display === "A.B.C.D") return /^[\d.]+$/u.test(typed);
  if (token.display.startsWith("X:X::X")) return /^[\da-f:/]+$/iu.test(typed);
  if (token.display === "INTERFACE") return /^[a-z][\w./:-]*$/iu.test(typed);
  if (token.display === "<vlan-list>") return /^[\d,-]+$/u.test(typed);
  if (token.display.startsWith("<")) return /^\d+$/u.test(typed);
  return /^\S+$/u.test(typed);
};
