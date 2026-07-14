import { commandGrammarTokens } from "./cli-grammar.ts";
import { teachingFor } from "./command-teaching.ts";
import type { DeviceProfileId } from "./device-profiles.ts";
import type { CliMode, Command } from "./engine.ts";

/**
 * The learning layer describes an outcome; the command registry decides
 * whether an inert line of player input satisfies it. Keeping this model free
 * of accepted-answer arrays prevents help, labs and timed modes from drifting.
 */
export type LearningTaskKind =
  | "navigation"
  | "inspection"
  | "configuration"
  | "verification"
  | "editing"
  | "recovery";

export type SemanticSuccessCondition =
  | { type: "command-event"; commandId: string }
  | { type: "context"; mode: CliMode }
  | { type: "state-effect"; effect: string }
  | { type: "output"; evidence: string }
  | { type: "control-event"; event: string };

export interface SeededStartingState {
  hostname: "R1" | "SW1";
  mode: CliMode;
  deviceProfile: DeviceProfileId;
}

export interface LearningTask {
  id: string;
  commandId: string;
  conceptId: string;
  deviceProfile: SeededStartingState["deviceProfile"];
  startingState: SeededStartingState;
  requiredContext: CliMode;
  kind: LearningTaskKind;
  task: string;
  whyThisMatters: string;
  hint1: string;
  hint2: string;
  canonicalCommand: string;
  semanticSuccess: SemanticSuccessCondition;
  expectedEffect: string;
  correctExplanation: string;
  verification: string;
  outputInterpretation: string;
  commonFailure: string;
  recovery: string;
  tags: string[];
  prerequisites: string[];
  acceptedSemanticAlternatives: string[];
}

type TaskOverride = Partial<Omit<LearningTask,
  "id" | "commandId" | "canonicalCommand" | "requiredContext" | "startingState"
>>;

const taskOverrides: Readonly<Record<string, TaskOverride>> = {
  "nav.enable": {
    conceptId: "cli.privilege.enter",
    task: "Move from User EXEC mode (R1>) to Privileged EXEC mode (R1#).",
    whyThisMatters: "Privileged EXEC provides administrative and detailed verification commands without changing configuration by itself.",
    hint1: "Privileged EXEC provides administrative and detailed verification commands. Its prompt ends in #.",
    hint2: "Use the EXEC command that raises the session's privilege level. It begins with en.",
    expectedEffect: "The prompt changes from R1> to R1#; running configuration is unchanged.",
    correctExplanation: "This raises the session from User EXEC to Privileged EXEC without changing device configuration.",
    verification: "Confirm that the prompt ends in #.",
    outputInterpretation: "A # prompt proves the session can use privileged inspection and configuration-entry commands.",
    commonFailure: "Do not confuse gaining privilege with entering Global Configuration mode.",
    recovery: "Use disable to return to User EXEC.",
    semanticSuccess: { type: "context", mode: "privileged" },
  },
  "nav.configure": {
    conceptId: "cli.configuration.enter",
    task: "Enter Global Configuration mode to change the running configuration.",
    whyThisMatters: "Feature changes begin in Global Configuration mode and take effect in running configuration immediately.",
    hint1: "The target prompt is R1(config)#. Changes there affect the active configuration.",
    hint2: "Configure the device using the terminal as the configuration source.",
    expectedEffect: "The prompt changes from R1# to R1(config)#; nothing is saved automatically.",
    correctExplanation: "This opens Global Configuration mode so later feature commands can change running configuration.",
    verification: "Confirm that the prompt ends in (config)#.",
    outputInterpretation: "The (config) marker identifies global scope; it does not prove that startup configuration was updated.",
    commonFailure: "This command is valid from Privileged EXEC, not User EXEC.",
    recovery: "Use end to return to Privileged EXEC without undoing changes already entered.",
    semanticSuccess: { type: "context", mode: "global" },
  },
  "nav.interface": {
    conceptId: "cli.interface.enter",
    task: "Enter configuration mode for the named GigabitEthernet interface.",
    whyThisMatters: "Interface scope keeps an address, description or administrative change attached to the intended port.",
    hint1: "Interface-specific settings are changed from Interface Configuration mode.",
    hint2: "Select the interface by its type and number.",
    expectedEffect: "The selected interface is recorded and the prompt changes to R1(config-if)#.",
    correctExplanation: "This selects one interface; it does not enable the interface or change its address by itself.",
    verification: "Confirm the (config-if)# prompt, then inspect the selected interface before changing it.",
    outputInterpretation: "The prompt proves the scope, while show output proves which configured state the interface holds.",
    commonFailure: "An interface alias is accepted only when the type and number exist on the selected virtual device.",
    recovery: "Use exit to return one level or end to return to Privileged EXEC.",
    semanticSuccess: { type: "context", mode: "interface" },
  },
  "config.enable-secret": {
    conceptId: "security.enable-secret",
    task: "Protect Privileged EXEC with the supplied case-sensitive secret.",
    whyThisMatters: "The enable secret protects the privilege boundary and is preferred to the older enable password form.",
    hint1: "Configure this globally. The supplied secret is case-sensitive and should not be displayed afterwards.",
    hint2: "Use the enable command family with its secret form, followed by the supplied value.",
    expectedEffect: "A protected enable-secret setting exists in running configuration without exposing its plaintext value.",
    correctExplanation: "This sets the case-sensitive secret used to protect entry to Privileged EXEC.",
    verification: "Test enable from a separate recovery-safe session on an isolated lab image.",
    outputInterpretation: "A successful privilege prompt proves authentication worked; stored secret material must remain redacted.",
    commonFailure: "Secret values are case-sensitive even though IOS command keywords are not.",
    recovery: "Set and test a replacement secret before removing the existing protection.",
    semanticSuccess: { type: "state-effect", effect: "enable-secret-set" },
  },
  "config.password-encryption": {
    conceptId: "security.legacy-password-obfuscation",
    task: "Obscure the remaining plaintext-style passwords in the configuration.",
    whyThisMatters: "This reduces casual exposure in configuration output, but it is not strong password protection.",
    hint1: "The setting applies reversible obfuscation to supported legacy password fields.",
    hint2: "Use the global service whose name ends in password-encryption.",
    expectedEffect: "Supported legacy plaintext-style password fields are stored using reversible Type 7 obfuscation.",
    correctExplanation: "This obscures supported plaintext-style passwords; it is not secure encryption or a replacement for secrets.",
    verification: "Inspect only sanitised configuration output and confirm secret-based controls still use protected forms.",
    outputInterpretation: "An encoded legacy field is less casually readable, but should still be treated as recoverable plaintext.",
    commonFailure: "Do not describe Type 7 as encryption or rely on it as the primary credential control.",
    recovery: "Use no service password-encryption only under an explicit policy; existing values may remain encoded.",
    semanticSuccess: { type: "state-effect", effect: "legacy-password-obfuscation-enabled" },
  },
  "show.ip-interface-brief": {
    conceptId: "interfaces.ipv4.summary",
    task: "Check the IPv4 address and line state of every interface.",
    whyThisMatters: "The concise table separates addressing, administrative or physical status and line-protocol state.",
    hint1: "Use one read-only summary that shows IP-Address, Status and Protocol columns.",
    hint2: "Use the show ip interface command family and request its brief form.",
    expectedEffect: "A read-only interface summary is emitted and device state is unchanged.",
    correctExplanation: "This lists interface addresses and state. Administratively down means configuration has disabled the interface.",
    verification: "Read the intended address, Status and Protocol from the same interface row.",
    outputInterpretation: "Up/down means the interface status is up while its line protocol is down; investigate the link or Layer 2 state.",
    commonFailure: "Do not infer interface health from the address column alone.",
    recovery: "No rollback is required because this is read-only.",
    semanticSuccess: { type: "output", evidence: "interface-summary-rendered" },
  },
  "interface.no-shutdown": {
    conceptId: "interfaces.admin.enable",
    task: "Enable the selected interface without changing its address.",
    whyThisMatters: "A correctly addressed router interface cannot forward while it remains administratively disabled.",
    hint1: "Remove the configured administrative shutdown from the selected interface.",
    hint2: "Use the no form of the interface's shutdown setting.",
    expectedEffect: "The selected interface is no longer administratively disabled.",
    correctExplanation: "This removes administrative shutdown; cabling, the peer and Layer 2 settings still determine whether it reaches up/up.",
    verification: "Inspect the selected interface and confirm both Status and Protocol for the intended link.",
    outputInterpretation: "Up/up is operational. Down/down or up/down points to a physical, peer or data-link dependency.",
    commonFailure: "No shutdown is not proof of end-to-end reachability.",
    recovery: "Use shutdown during a planned outage if the interface must be withdrawn.",
    semanticSuccess: { type: "state-effect", effect: "selected-interface-admin-up" },
  },
  "tools.ping": {
    conceptId: "connectivity.ipv4.ping",
    task: "Test IP reachability to the named directly connected peer.",
    whyThisMatters: "A controlled ping checks bidirectional IP reachability after local interface state has been verified.",
    hint1: "Send ICMP echo requests to the supplied IPv4 address.",
    hint2: "Use the ping command family followed by the target address.",
    expectedEffect: "The simulator emits deterministic echo results derived from interface, route, ARP and return-path state.",
    correctExplanation: "Ping sends ICMP echo requests. ! means a reply and . means a timeout; it does not test every application port.",
    verification: "Read the success rate and correlate a failure with the simulator's stated cause.",
    outputInterpretation: "A success proves bidirectional IP reachability for the probe; a failure must be narrowed with state and route evidence.",
    commonFailure: "Do not blame DNS for a failed test to a numeric address.",
    recovery: "No rollback is required because this is read-only.",
    semanticSuccess: { type: "output", evidence: "ping-success" },
  },
  "config.save": {
    conceptId: "configuration.save",
    task: "Save the verified running configuration for the next restart.",
    whyThisMatters: "Running configuration is active now; startup configuration is the snapshot loaded after a restart.",
    hint1: "Copy the active configuration into startup storage only after verification.",
    hint2: "Use the copy command family from running-config to startup-config.",
    expectedEffect: "Startup configuration becomes a snapshot of the verified running configuration.",
    correctExplanation: "This persists the current running configuration; it does not prove that the saved configuration is correct.",
    verification: "Compare the relevant running and startup sections after the simulated copy completes.",
    outputInterpretation: "[OK] confirms the copy completed, not that every configured value is operationally sound.",
    commonFailure: "Saving a faulty running configuration preserves the fault.",
    recovery: "Restore a known-good snapshot or correct the running state, verify it and save again.",
    semanticSuccess: { type: "state-effect", effect: "startup-snapshot-equals-running" },
    acceptedSemanticAlternatives: ["write memory", "write"],
  },
  "config.reload": {
    conceptId: "configuration.restart-from-startup",
    task: "Restart the simulated device from its saved startup configuration.",
    whyThisMatters: "A restart is disruptive and discards unsaved running changes, so it belongs behind an explicit impact check and confirmation.",
    hint1: "Confirm that required changes are saved and that an interruption is acceptable before restarting the device.",
    hint2: "Use the one-word restart command, then answer its confirmation prompt deliberately.",
    expectedEffect: "The simulator restores the saved startup snapshot and clears unsaved running changes after confirmation.",
    correctExplanation: "This restarts the simulated device. It is not the normal way to undo one mistaken line.",
    verification: "After the device returns, compare the relevant running state with the saved startup snapshot.",
    outputInterpretation: "A completed restart proves the saved snapshot was loaded; it does not prove that snapshot is operationally correct.",
    commonFailure: "Do not restart merely to correct one command, and do not assume unsaved work will survive.",
    recovery: "Use the saved lab checkpoint if the restart makes the exercise unrecoverable.",
    semanticSuccess: { type: "state-effect", effect: "startup-snapshot-restored" },
  },
  "nav.vlan-20": {
    conceptId: "switching.vlan-20.enter",
    task: "Open configuration for the user access segment numbered 20.",
    whyThisMatters: "VLAN configuration creates the Layer 2 segment before access ports can be assigned to it.",
    hint1: "Work from Global Configuration and select the supplied Layer 2 segment identifier.",
    hint2: "Use the VLAN command family followed by the supplied user-segment number.",
    expectedEffect: "VLAN 20 exists and the prompt changes to SW1(config-vlan)#.",
    correctExplanation: "This creates VLAN 20 if needed and enters its configuration context; it does not assign any ports by itself.",
    verification: "Return to Privileged EXEC and inspect the VLAN table for VLAN 20 and its member ports.",
    outputInterpretation: "An active VLAN row proves the segment exists; port membership must be checked separately.",
    commonFailure: "Creating a VLAN does not automatically place an access port in it.",
    recovery: "Remove only VLAN 20 after moving any dependent ports and confirming the operational impact.",
    semanticSuccess: { type: "context", mode: "vlan" },
  },
  "nav.vlan-99": {
    conceptId: "switching.vlan-99.enter",
    task: "Open configuration for the management segment numbered 99.",
    whyThisMatters: "A dedicated management VLAN separates administrative traffic from ordinary user access traffic.",
    hint1: "Work from Global Configuration and select the supplied management segment identifier.",
    hint2: "Use the VLAN command family followed by the supplied management-segment number.",
    expectedEffect: "VLAN 99 exists and the prompt changes to SW1(config-vlan)#.",
    correctExplanation: "This creates VLAN 99 if needed and enters its configuration context; the management SVI is configured separately.",
    verification: "Inspect the VLAN table, then verify the Vlan99 interface and its active member-port dependency.",
    outputInterpretation: "The VLAN row proves Layer 2 existence; an up management SVI also needs an active member port or trunk.",
    commonFailure: "Creating the VLAN alone does not assign an IP address or bring its SVI up.",
    recovery: "Remove only VLAN 99 after moving management access and preserving a recovery path.",
    semanticSuccess: { type: "context", mode: "vlan" },
  },
};

const switchSignals = /(?:switchport|vlan|spanning-tree|etherchannel|lacp|pagp|port-security|dhcp snooping|arp inspection|mac address-table|standby)/iu;

const profileFor = (command: Command): SeededStartingState["deviceProfile"] =>
  command.deviceProfile ?? (switchSignals.test(`${command.canonical} ${command.topic}`)
    ? "catalyst-l2"
    : "router-ios-xe");

const taskKindFor = (command: Command): LearningTaskKind => {
  if (command.kind === "navigation") return "navigation";
  if (command.kind === "verification") return "inspection";
  if (/^(?:erase|reload|configure replace|default interface)/iu.test(command.canonical)) return "recovery";
  return "configuration";
};

const contextGuidance: Readonly<Record<CliMode, string>> = {
  user: "The > prompt permits basic checks and session entry, but not configuration changes.",
  privileged: "Work from the # prompt, where operational checks and configuration-management actions are available.",
  global: "The (config)# prompt changes device-wide running configuration immediately; it does not save it.",
  interface: "The (config-if)# prompt limits the change to the selected interface, so confirm that scope first.",
  router: "The (config-router)# prompt limits the change to the selected routing process.",
  line: "The (config-line)# prompt applies policy to the selected console or VTY lines.",
  vlan: "The (config-vlan)# prompt changes only the selected Layer 2 VLAN object.",
  acl: "The named ACL prompt edits an ordered first-match policy with an implicit final deny.",
  dhcp: "The (dhcp-config)# prompt changes options for one selected address pool.",
};

const topicGuidance: Readonly<Record<string, string>> = {
  "CLI navigation": "Read the whole prompt as a location marker; moving context does not itself change a feature.",
  "CLI and system": "Use session and time evidence to establish what the device and operator were doing before a change.",
  Connectivity: "A probe tests one path and protocol; its result must be correlated with interface and route state.",
  "Device verification": "Separate software identity, hardware inventory and component health instead of treating them as one fact.",
  "Configuration management": "Keep active running state, saved startup state and recoverable checkpoints distinct.",
  "Interface verification": "Read address, administrative state, physical state and line protocol as separate pieces of evidence.",
  "Interface configuration": "Change only the selected port, then prove both its configured state and operational dependency.",
  Routing: "A forwarding decision needs a matching prefix and a resolvable next hop or exit interface.",
  OSPF: "Distinguish process policy, participating interfaces, neighbour state and learned routes.",
  "Layer 2 switching": "Keep access membership, voice membership and trunk carriage as separate Layer 2 decisions.",
  VLANs: "A VLAN can exist without any useful member ports, and a trunk can omit an otherwise valid VLAN.",
  "Spanning Tree": "Confirm topology and port role before changing loop-prevention behaviour.",
  EtherChannel: "A bundle forms only when member settings and the chosen negotiation method agree.",
  "Neighbour discovery": "A neighbour table depends on a working link and a discovery protocol enabled at both relevant scopes.",
  "Device configuration": "Choose a neutral, recognisable device-wide value and verify its effect in the prompt or running state.",
  "Device hardening": "Treat this as one defence layer; it does not replace strong secrets or encrypted management.",
  "Secure management": "Preserve a tested recovery session while changing authentication, authorisation or remote access.",
  "Monitoring services": "Reachability, source identity, time and severity must agree for monitoring evidence to be useful.",
  Troubleshooting: "Collect the smallest evidence that can distinguish the likely causes before changing state.",
  IPv6: "Use prefix length and IPv6 neighbour or route evidence; do not transpose IPv4 mask assumptions.",
  "Access control": "Reason in sequence order, including direction, placement, first match and the implicit final deny.",
  DHCP: "Pool network, exclusions, gateway and DNS options must describe the same client subnet.",
  NAT: "Translation depends on inside/outside roles, a matching rule and working routing in both directions.",
  "Switch security": "Apply the control at the intended trust boundary and verify the exact port or VLAN scope.",
  "First-hop redundancy": "Virtual address, group, priority and pre-emption must be interpreted together across peers.",
};

const navigationHint = (command: Command): string => {
  const canonical = command.canonical.toLocaleLowerCase("en-GB");
  if (canonical === "enable") return "Privileged EXEC provides administrative checks and its prompt ends in #; no configuration changes yet.";
  if (canonical === "disable") return "The lower-privilege destination uses a > prompt and leaves running configuration untouched.";
  if (canonical === "configure terminal") return "The target prompt ends in (config)#, where changes affect running configuration immediately.";
  if (canonical.startsWith("interface range ")) return `Select the declared ports as one scope and confirm every expanded member before applying a change. ${command.objective}`;
  if (canonical.startsWith("interface ")) return `Select the named interface so the prompt identifies a single interface or subinterface scope. ${command.objective}`;
  if (canonical.startsWith("router ")) return "Select the stated routing process; its dedicated prompt keeps process policy separate from global state.";
  if (canonical.startsWith("line ")) return `Select the stated terminal lines; remote-session policy belongs in their dedicated line context. ${command.objective}`;
  if (canonical.startsWith("vlan ")) return "Select the supplied Layer 2 segment; creating its object does not assign any ports.";
  if (canonical.startsWith("ip access-list ")) return `Open the named ordered policy so later entries are evaluated in sequence rather than globally. ${command.objective}`;
  if (canonical.startsWith("ip dhcp pool ")) return "Open the named address pool; network and client options belong inside its dedicated scope.";
  if (canonical === "end") return `Leave all nested ${command.mode} configuration levels at once and look for the Privileged EXEC # prompt.`;
  if (canonical === "exit") return `Move back exactly one level from ${command.mode}; existing running changes remain in place.`;
  if (canonical === "logout") return "Close the EXEC session rather than merely lowering privilege or leaving a configuration subcontext.";
  return `${contextGuidance[command.mode]} ${command.objective}`;
};

const evidenceHint = (command: Command): string => {
  const canonical = command.canonical.toLocaleLowerCase("en-GB");
  if (canonical.startsWith("ping ")) return `Read the success rate and symbols, then relate any failure to interface, route, ARP and return-path state. ${command.objective}`;
  if (canonical.startsWith("traceroute ")) return `Read responding hops in order; the first missing response narrows the path but does not prove the failed component alone. ${command.objective}`;
  if (canonical.startsWith("ssh ")) return `Use a separate simulated session so authentication and EXEC access are proved without risking the recovery session. ${command.objective}`;
  if (canonical.includes("running-config")) return "Inspect active state now; do not assume it will survive a restart until startup state is checked separately.";
  if (canonical.includes("startup-config")) return "Inspect the restart snapshot and compare the required section with active running state.";
  if (canonical.includes("interface brief")) return `Read address, Status and Protocol on the same row; each column answers a different diagnostic question. ${command.objective}`;
  if (canonical.includes("route")) return `Find the most-specific matching prefix, then confirm that its next hop or exit interface can actually be resolved. ${command.objective}`;
  if (canonical.includes("vlan") || canonical.includes("trunk")) return `Check that the VLAN exists, has the intended membership and is carried by the required trunk; none implies the others. ${command.objective}`;
  if (canonical.includes("spanning-tree")) return `Interpret root identity, port role and forwarding state together before deciding that the Layer 2 path is healthy. ${command.objective}`;
  if (canonical.includes("etherchannel") || canonical.includes("lacp") || canonical.includes("pagp")) return `Read the protocol and member flags; a group number alone does not prove that every link bundled. ${command.objective}`;
  if (canonical.includes("access-list")) return `Read entries in sequence and look for the intended match before the implicit deny; counters add evidence when traffic is simulated. ${command.objective}`;
  if (canonical.includes("dhcp")) return `Correlate pool subnet, exclusions, bindings and conflicts; one populated field does not prove successful client service. ${command.objective}`;
  if (canonical.includes("ssh") || canonical.includes("login") || canonical.includes("users") || canonical.includes("sessions")) return `Separate server policy, authenticated users and active sessions; each view proves a different management-plane fact. ${command.objective}`;
  return `${topicGuidance[command.topic] ?? "Interpret the requested field against a known-good baseline before acting."} The evidence must answer: ${command.objective}`;
};

const configurationHint = (command: Command): string => {
  const topic = topicGuidance[command.topic]
    ?? "Make one deliberate change in the narrowest valid scope, then verify its observable effect.";
  return `${contextGuidance[command.mode]} ${topic} Intended outcome: ${command.objective}`;
};

const hint1For = (command: Command): string => command.kind === "navigation"
  ? navigationHint(command)
  : command.kind === "verification"
    ? evidenceHint(command)
    : configurationHint(command);

const hint2For = (command: Command): string => {
  const teaching = teachingFor(command);
  const firstKeyword = commandGrammarTokens(command).find((token) => token.kind === "keyword")?.source ?? "command";
  return `Use the ${firstKeyword} family from ${command.mode}. Syntax: ${teaching.syntax}. Replace only the displayed placeholders with the supplied task data.`;
};

const prerequisitesFor = (command: Command): string[] => {
  const contextEntry: Partial<Record<CliMode, string>> = {
    privileged: "nav.enable",
    global: "nav.configure",
    interface: "nav.interface",
    router: "nav.router",
    line: "nav.line-vty",
    vlan: "nav.vlan-20",
    acl: command.id.includes("standard") ? "nav.acl-standard" : "nav.acl-extended",
    dhcp: "nav.dhcp-users",
  };
  const prerequisites = new Set<string>();
  const entry = contextEntry[command.mode];
  if (entry && entry !== command.id) prerequisites.add(entry);

  if (command.id === "config.crypto-key") prerequisites.add("config.domain-name");
  if (command.id === "config.ssh-version") prerequisites.add("config.crypto-key");
  if (command.id === "user.ssh") prerequisites.add("config.ssh-version");
  if (command.id.startsWith("interface.hsrp-")) prerequisites.add("interface.ipv4");
  if (command.id === "config.dhcp-snooping-vlan") prerequisites.add("config.dhcp-snooping");
  if (command.id === "interface.dhcp-trust") prerequisites.add("config.dhcp-snooping-vlan");
  if (command.id === "interface.arp-trust") prerequisites.add("config.arp-inspection-vlan");
  if (command.id === "interface.trunk-allowed" || command.id === "interface.trunk-native") prerequisites.add("interface.trunk");
  if (command.id.startsWith("interface.port-security-") && command.id !== "interface.port-security") prerequisites.add("interface.port-security");
  if (command.id.startsWith("dhcp.") && command.id !== "dhcp.network") prerequisites.add("dhcp.network");
  if (command.id === "router.default-originate") prerequisites.add("route.default");
  return [...prerequisites];
};

const genericCondition = (command: Command): SemanticSuccessCondition => {
  if (command.kind === "navigation") return { type: "command-event", commandId: command.id };
  if (command.kind === "verification") {
    if (command.id === "tools.ping" || command.id === "verify.ping-source") {
      return { type: "output", evidence: "ping-success" };
    }
    if (command.id === "tools.traceroute" || command.id === "verify.traceroute-source") {
      return { type: "output", evidence: "trace-complete" };
    }
    if (command.id === "user.ssh") return { type: "output", evidence: "ssh-session-established" };
    return { type: "output", evidence: "inspection-output" };
  }
  return { type: "state-effect", effect: command.id };
};

const conceptFor = (command: Command): string => {
  const stem = command.id.replace(/^(?:show|config|interface|router|line|vlan|acl|dhcp|nav|tools|verify)\./u, "");
  return `${command.topic.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/gu, ".").replace(/^\.|\.$/gu, "")}.${stem}`;
};

/** Builds a complete task without storing any manual abbreviation list. */
export const learningTaskFor = (command: Command): LearningTask => {
  const teaching = teachingFor(command);
  const deviceProfile = profileFor(command);
  const override = taskOverrides[command.id] ?? {};
  const base: LearningTask = {
    id: `task.${command.id}`,
    commandId: command.id,
    conceptId: conceptFor(command),
    deviceProfile,
    startingState: {
      hostname: deviceProfile === "catalyst-l2" ? "SW1" : "R1",
      mode: command.mode,
      deviceProfile,
    },
    requiredContext: command.mode,
    kind: taskKindFor(command),
    task: command.objective,
    whyThisMatters: teaching.whenToUse,
    hint1: hint1For(command),
    hint2: hint2For(command),
    canonicalCommand: command.canonical,
    semanticSuccess: genericCondition(command),
    expectedEffect: teaching.expected,
    correctExplanation: teaching.purpose,
    verification: teaching.verify,
    outputInterpretation: teaching.mentalModel,
    commonFailure: teaching.commonTrap,
    recovery: teaching.rollback,
    tags: [command.topic, command.mode, command.kind],
    prerequisites: prerequisitesFor(command),
    acceptedSemanticAlternatives: [],
  };
  const result = { ...base, ...override };
  return {
    ...result,
    startingState: {
      ...base.startingState,
      deviceProfile: result.deviceProfile,
      hostname: result.deviceProfile === "catalyst-l2" ? "SW1" : "R1",
    },
  };
};

export const buildLearningTasks = (catalogue: readonly Command[]): LearningTask[] =>
  catalogue.map(learningTaskFor);

export const learningTaskMap = (catalogue: readonly Command[]): ReadonlyMap<string, LearningTask> =>
  new Map(buildLearningTasks(catalogue).map((task) => [task.commandId, task]));

export interface SemanticTaskObservation {
  commandId?: string;
  canonicalInput?: string;
  beforeContext: string;
  afterContext: string;
  output: readonly string[];
  stateEffects: readonly string[];
  controlEvent?: string;
}

const normaliseCommand = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");

/**
 * Evaluate a learning outcome from the parsed event and resulting simulator
 * observation. This deliberately does not compare the learner's raw line with
 * an answer string; aliases and other commands may satisfy the same state
 * predicate when the task explicitly permits that outcome.
 */
export const learningTaskSatisfied = (
  task: LearningTask,
  observation: SemanticTaskObservation,
): boolean => {
  const condition = task.semanticSuccess;
  const submitted = normaliseCommand(observation.canonicalInput ?? "");
  const declaredAlternative = task.acceptedSemanticAlternatives
    .some((alternative) => normaliseCommand(alternative) === submitted);
  switch (condition.type) {
    case "command-event":
      return observation.commandId === condition.commandId || declaredAlternative;
    case "context":
      return observation.afterContext === condition.mode
        && observation.beforeContext !== observation.afterContext
        && (observation.commandId === task.commandId || declaredAlternative);
    case "state-effect":
      return observation.stateEffects.includes(condition.effect);
    case "output":
      if (observation.commandId !== task.commandId && !declaredAlternative) return false;
      if (!observation.output.length) return false;
      if (condition.evidence === "ping-success") {
        return observation.output.some((line) => /Success rate is 100 percent/iu.test(line));
      }
      if (condition.evidence === "trace-complete") {
        return !observation.output.some((line) => /Trace incomplete|\* \* \*/iu.test(line));
      }
      if (condition.evidence === "ssh-session-established") {
        return observation.output.some((line) => /session established|fallback accepted/iu.test(line));
      }
      return observation.output.some((line) => line.trim().length > 0);
    case "control-event":
      return observation.controlEvent === condition.event;
  }
};

export interface TaskAssistanceState {
  hintUsed: boolean;
  tabUsed: boolean;
  helpUsed: boolean;
  answerRevealed: boolean;
}

export type LearningOutcome =
  | "independent"
  | "guided-discovery"
  | "assisted"
  | "revealed"
  | "incorrect"
  | "skipped";

/** The most restrictive evidence wins; a reveal can never become mastery. */
export const classifyLearningOutcome = (
  correct: boolean,
  assistance: TaskAssistanceState,
  skipped = false,
): LearningOutcome => {
  if (skipped) return "skipped";
  if (!correct) return "incorrect";
  if (assistance.answerRevealed) return "revealed";
  if (assistance.hintUsed || assistance.tabUsed) return "assisted";
  if (assistance.helpUsed) return "guided-discovery";
  return "independent";
};
