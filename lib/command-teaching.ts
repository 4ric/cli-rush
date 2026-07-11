import type { CliMode, Command, CommandKind } from "./engine.ts";

export interface CommandTeaching {
  purpose: string;
  whenToUse: string;
  syntax: string;
  expected: string;
  verify: string;
  commonTrap: string;
  rollback: string;
  risk: string;
}

type TeachingInput = Pick<Command, "id" | "mode" | "canonical" | "topic" | "kind">;

const modePrompt: Record<CliMode, string> = {
  user: "the User EXEC prompt",
  privileged: "the Privileged EXEC prompt",
  global: "global configuration mode",
  interface: "interface configuration mode",
  router: "router configuration mode",
  line: "line configuration mode",
  vlan: "VLAN configuration mode",
  acl: "named ACL configuration mode",
  dhcp: "DHCP pool configuration mode",
};

const useCases: Record<string, string> = {
  "CLI navigation": "Use it to reach the correct command context before making or checking a change.",
  "CLI and system": "Use it when checking the session, device time or recent operator activity.",
  Connectivity: "Use it after establishing a baseline or change to test the path to a known destination.",
  "Device verification": "Use it during inventory, software and platform checks before planning a change.",
  "Configuration management": "Use it to compare active and saved state, preserve a known-good configuration or prepare a rollback.",
  "Interface verification": "Use it to establish interface state before troubleshooting and to verify the result afterwards.",
  "Interface configuration": "Use it when commissioning, isolating or correcting a routed interface.",
  Routing: "Use it when establishing or checking how IPv4 traffic will leave the device.",
  OSPF: "Use it while building or troubleshooting OSPF neighbour formation and route exchange.",
  "Layer 2 switching": "Use it when assigning edge ports and checking switching state.",
  VLANs: "Use it when creating broadcast domains or controlling trunk and access-port membership.",
  "Spanning Tree": "Use it to prevent Layer 2 loops and confirm the intended root and port roles.",
  EtherChannel: "Use it when bundling compatible links and verifying negotiation and member consistency.",
  "Neighbour discovery": "Use it to identify directly connected devices and correlate Layer 2 and Layer 3 neighbours.",
  "Device configuration": "Use it while establishing predictable device identity and operator behaviour.",
  "Device hardening": "Use it as one layer of management-plane hardening, alongside stronger secrets and access controls.",
  "Secure management": "Use it when securing local and remote administrative access.",
  "Monitoring services": "Use it when configuring or checking logging, time and telemetry services.",
  Troubleshooting: "Use it to collect evidence and identify a constrained resource or failing component.",
  IPv6: "Use it in a dual-stack workflow to configure or verify IPv6 forwarding and neighbour discovery.",
  "Access control": "Use it when defining, applying and verifying deterministic traffic policy.",
  DHCP: "Use it when supplying IPv4 addressing parameters or diagnosing client lease allocation.",
  NAT: "Use it when translating inside IPv4 addresses and verifying the resulting sessions.",
  "Switch security": "Use it to constrain edge-port behaviour and reduce common Layer 2 attacks.",
  "First-hop redundancy": "Use it to provide and verify a resilient default gateway for a subnet.",
};

const traps: Record<string, string> = {
  "CLI navigation": "Check the prompt before typing; the same keyword can have a different meaning or be unavailable in another mode.",
  Connectivity: "A failed probe does not identify the cause by itself; verify addressing, routing, filtering and the return path.",
  "Interface verification": "Do not treat physical status, line protocol and IP addressing as the same condition.",
  "Interface configuration": "A correct address is still unusable if the mask is wrong, the port is shut or the peer is misconfigured.",
  Routing: "Keep subnet masks, wildcard masks and next-hop addresses in their correct fields.",
  OSPF: "OSPF network statements use wildcard masks and select interfaces; they do not directly advertise an arbitrary prefix.",
  "Layer 2 switching": "Access VLAN assignment and trunk allowance are different operations and must agree with the neighbouring port.",
  VLANs: "Creating a VLAN does not automatically place ports in it or permit it across every trunk.",
  "Spanning Tree": "Changing root or edge behaviour without checking the topology can create disruption or a loop.",
  EtherChannel: "Member speed, duplex, switchport mode and allowed VLAN settings must be consistent across the bundle.",
  "Neighbour discovery": "A missing neighbour can mean discovery is disabled, the link is down or the peer uses another protocol.",
  "Secure management": "Obfuscation is not encryption; prefer secrets, SSH and least-privilege access.",
  "Monitoring services": "Time, reachability, source interfaces and severity filters must agree at both ends.",
  IPv6: "Do not substitute an IPv4 subnet mask; IPv6 configuration uses prefix lengths.",
  "Access control": "ACLs are ordered, first-match policies with an implicit deny; direction and placement matter.",
  DHCP: "The pool network, mask, exclusions, gateway and DNS values must describe the same client subnet.",
  NAT: "Inside/outside roles, ACL matching and routing must all be correct before translations can form.",
  "Switch security": "Enable protections only on the intended trust boundary; marking an untrusted port as trusted defeats the control.",
  "First-hop redundancy": "Group number, virtual address, priority and pre-emption must be consistent across peers.",
  "Configuration management": "Saving preserves the current state, including mistakes; verify before copying running state to startup storage.",
};

const verification: Record<string, string> = {
  "Interface configuration": "Verify with show ip interface brief, then inspect the specific interface and test the expected path.",
  "Interface verification": "Compare the displayed address, status, protocol and counters with the intended baseline.",
  Routing: "Verify with show ip route and use ping or traceroute to test the forwarding and return paths.",
  OSPF: "Verify neighbours, interface participation and learned routes with the relevant show ip ospf commands.",
  "Layer 2 switching": "Verify VLAN membership, switchport mode, trunk state and MAC learning.",
  VLANs: "Verify with show vlan brief and show interfaces trunk or switchport as appropriate.",
  "Spanning Tree": "Verify the root, port roles and forwarding state for the affected VLAN.",
  EtherChannel: "Verify the bundle and member flags with show etherchannel summary and the negotiation protocol view.",
  "Secure management": "Test a separate management session before closing the current one, then inspect login and SSH state.",
  "Monitoring services": "Verify service status, peer reachability and fresh records in the appropriate show output.",
  "Access control": "Inspect the ACL in sequence order, confirm its interface and direction, then check match counters with controlled traffic.",
  DHCP: "Verify pool utilisation, bindings and conflicts, then renew a test client lease.",
  NAT: "Generate controlled traffic and inspect NAT statistics and translations.",
  "Switch security": "Inspect the feature state and bindings on the exact interface or VLAN that was changed.",
  "First-hop redundancy": "Verify the active and standby roles and test the virtual gateway during a controlled failover.",
  "Configuration management": "Compare running and startup state and confirm that the expected configuration is present.",
};

const variableSyntax = (canonical: string): string => {
  const tokens = canonical.trim().split(/\s+/u);
  return tokens.map((token, index) => {
    const lower = token.toLocaleLowerCase("en-GB");
    const previous = tokens[index - 1]?.toLocaleLowerCase("en-GB") ?? "";
    const beforePrevious = tokens[index - 2]?.toLocaleLowerCase("en-GB") ?? "";
    if (/^(?:gigabit|fast|ten)?ethernet\d+(?:\/\d+)+(?:\.\d+)?$/iu.test(token)) return "<interface>";
    if (/^[0-9a-f]*:[0-9a-f:]+(?:\/\d+)?$/iu.test(token)) return "<IPv6-prefix>";
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(token)) {
      if (previous === "address") return "<IPv4-address>";
      if (beforePrevious === "address") return "<subnet-mask>";
      if (previous === "network" && tokens[0]?.toLocaleLowerCase("en-GB") === "network") return "<network>";
      if (beforePrevious === "network") return lower.startsWith("0.") ? "<wildcard-mask>" : "<subnet-mask>";
      if (lower === "0.0.0.0" && index === 2) return "<destination>";
      if (lower === "0.0.0.0" && index === 3) return "<subnet-mask>";
      return "<IPv4-address>";
    }
    if (/^\d+(?:-\d+)?$/u.test(token)) {
      if (["vlan", "native", "access", "voice"].includes(previous)) return "<VLAN-id>";
      if (previous === "area") return "<area-id>";
      if (previous === "ospf") return "<process-id>";
      if (previous === "priority") return "<priority>";
      if (previous === "lease") return "<days>";
      return "<value>";
    }
    if (previous === "hostname") return "<hostname>";
    if (previous === "username" || previous === "-l") return "<username>";
    if (previous === "description" || previous === "name" || previous === "domain-name") return "<text>";
    return token;
  }).join(" ");
};

const purposeFor = (command: TeachingInput): string => {
  const family = command.canonical.split(/\s+/u)[0]?.toLocaleLowerCase("en-GB");
  const topic = command.topic.toLocaleLowerCase("en-GB");
  if (family === "show" || family === "dir") {
    return `Reads ${topic} state without changing the active configuration; later keywords narrow the operational evidence returned.`;
  }
  if (family === "ping") return "Sends controlled echo probes so reachability and round-trip response can be checked without changing configuration.";
  if (family === "traceroute") return "Probes successive hops towards a destination so the point at which a routed path stops responding can be narrowed down.";
  if (command.kind === "navigation") {
    return `Moves the CLI session to or from ${modePrompt[command.mode]} so the next operation is entered in the correct scope.`;
  }
  if (family === "no") {
    return `Uses the IOS no form to remove or disable a ${topic} setting in ${modePrompt[command.mode]}.`;
  }
  if (family === "copy") return "Copies the active running configuration into startup storage so the intended state can survive a reload.";
  if (family === "erase" || family === "reload") return "Performs a disruptive configuration-management operation that should only follow verification and an explicit recovery plan.";
  return `Changes ${topic} state in ${modePrompt[command.mode]}; the command family selects the feature and its arguments select the target or value.`;
};

const expectedFor = (command: TeachingInput): string => {
  if (command.id === "show.ip-interface-brief") return "A compact table should show each interface, its IP address, physical status and line protocol state.";
  if (command.id === "interface.ipv4") return "The selected Layer 3 interface should retain the requested IPv4 address and subnet mask in running configuration.";
  if (command.id === "interface.no-shutdown") return "The interface should leave the administratively-down state; line protocol depends on the link and peer.";
  if (command.id === "config.save") return "IOS should report that it is building or copying the configuration and confirm completion.";
  if (command.kind === "verification") return "Expect read-only output that must be interpreted against the intended topology or baseline; an empty result is still diagnostic evidence.";
  if (command.kind === "navigation") return "Expect the prompt to change while the underlying feature state remains unchanged.";
  return "Expect running state to change only in the current configuration scope; many IOS configuration commands produce no success message.";
};

const rollbackFor = (command: TeachingInput): string => {
  const canonical = command.canonical.trim();
  const lower = canonical.toLocaleLowerCase("en-GB");
  if (command.kind === "verification") return "No rollback is required because the command is read-only.";
  if (command.kind === "navigation") return "Use exit to move back one context or end to return to Privileged EXEC, where supported.";
  if (lower.startsWith("no ")) return `Reapply the positive form only after confirming the intended setting: ${canonical.slice(3)}.`;
  if (lower === "reload" || lower.startsWith("erase ")) return "Use an out-of-band recovery plan or restore a known-good saved configuration; this action is intentionally disruptive.";
  if (lower.startsWith("copy ")) return "Restore a previously verified configuration rather than overwriting startup storage again blindly.";
  return `In the same configuration mode, use the tested no or default form for this feature; do not assume every platform accepts “no ${canonical}” unchanged.`;
};

const riskFor = (command: TeachingInput): string => {
  const lower = command.canonical.toLocaleLowerCase("en-GB");
  if (command.kind === "verification") return "Read-only in normal use; large outputs can still consume operator attention and terminal buffers.";
  if (command.kind === "navigation") return "Low risk by itself, but the destination mode may permit service-affecting changes.";
  if (/^(erase|reload|shutdown|no ip routing)/u.test(lower)) return "High impact: it can remove saved state, interrupt service or disable forwarding. Confirm access and recovery first.";
  if (command.topic === "Access control" || command.topic === "Secure management") return "Medium to high impact: a wrong policy can block production or management access. Preserve a tested recovery path.";
  return "Configuration change: verify scope, capture the baseline and retain a rollback path before using it on a real device.";
};

export const teachingFor = (command: TeachingInput): CommandTeaching => ({
  purpose: purposeFor(command),
  whenToUse: useCases[command.topic]
    ?? `Use it when working with ${command.topic.toLocaleLowerCase("en-GB")} and the objective requires this exact operation.`,
  syntax: variableSyntax(command.canonical),
  expected: expectedFor(command),
  verify: verification[command.topic]
    ?? (command.kind === "verification"
      ? "Interpret the output against a known baseline and corroborate it with the next most specific read-only command."
      : "Inspect running state with the most specific read-only show command and test the intended behaviour."),
  commonTrap: traps[command.topic]
    ?? "Confirm the current mode, argument order and platform support rather than relying on a memorised string alone.",
  rollback: rollbackFor(command),
  risk: riskFor(command),
});

export const teachingExplanation = (command: TeachingInput): string =>
  teachingFor(command).purpose;

export const commandKindLabel = (kind: CommandKind): string =>
  kind === "verification" ? "Read and interpret" : kind === "navigation" ? "Move context" : "Change state";
