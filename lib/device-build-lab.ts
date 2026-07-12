/**
 * Deterministic, local-only guided device builds.
 *
 * Player input is inert text and is compared with a bounded lesson catalogue.
 * It is never executed by a shell, evaluator, database or network device.
 */

export type DeviceBuildLabId = "router-foundation" | "switch-foundation";
export type DeviceBuildMode = "user" | "privileged" | "global" | "line" | "interface" | "radius" | "dhcp" | "vlan";
export type DeviceBuildPhase = "access" | "identity" | "security" | "services" | "interfaces" | "verification";

export interface DeviceBuildStep {
  id: string;
  phase: DeviceBuildPhase;
  mode: DeviceBuildMode;
  command: string;
  objective: string;
  why: string;
  detail: string;
  verify: string;
  rollback: string;
  output?: string[];
  nextMode?: DeviceBuildMode;
  nextHostname?: string;
  sensitiveTokens?: number[];
}

export interface DeviceBuildDefinition {
  id: DeviceBuildLabId;
  number: 2 | 3;
  shortTitle: string;
  title: string;
  summary: string;
  deviceType: "router" | "switch";
  steps: DeviceBuildStep[];
}

export interface DeviceBuildState {
  version: 1;
  labId: DeviceBuildLabId;
  stepIndex: number;
  mode: DeviceBuildMode;
  hostname: string;
  completed: boolean;
}

export interface DeviceBuildResult {
  accepted: boolean;
  state: DeviceBuildState;
  output: string[];
  explanation: string;
  useCase: string;
  verification: string;
  rollback: string;
  errorCode?: "EMPTY" | "TOO_LONG" | "WRONG_MODE" | "WRONG_COMMAND" | "COMPLETE";
}

const step = (
  id: string,
  phase: DeviceBuildPhase,
  mode: DeviceBuildMode,
  command: string,
  objective: string,
  why: string,
  detail: string,
  verify: string,
  rollback: string,
  options: Pick<DeviceBuildStep, "output" | "nextMode" | "nextHostname" | "sensitiveTokens"> = {},
): DeviceBuildStep => ({ id, phase, mode, command, objective, why, detail, verify, rollback, ...options });

const sharedOpening = (hostname: string): DeviceBuildStep[] => [
  step("enable", "access", "user", "enable", "Move from User EXEC to Privileged EXEC mode.", "User EXEC is deliberately restricted. Privileged EXEC gives an administrator access to inspection and configuration entry points.", "The prompt changes from > to #. That prompt symbol is a location marker: # means you can inspect the whole device and enter configuration mode.", "Confirm the prompt ends in #.", "Use disable to return to User EXEC.", { nextMode: "privileged" }),
  step("configure", "access", "privileged", "configure terminal", "Enter Global Configuration mode.", "Persistent feature changes begin in Global Configuration mode rather than at the EXEC prompt.", "The (config) marker shows that subsequent commands alter the running configuration. Nothing is saved to startup configuration until the final copy command.", "Confirm the prompt contains (config)#.", "Use end to return directly to Privileged EXEC.", { nextMode: "global" }),
  step("hostname", "identity", "global", `hostname ${hostname}`, `Give the device the hostname ${hostname}.`, "A meaningful hostname identifies the device in prompts, logs and monitoring systems, reducing the chance of configuring the wrong box.", "Hostname changes take effect immediately in the prompt. A consistent site-role-number naming standard is more useful than a decorative name.", `Confirm the next prompt begins ${hostname}.`, "Use hostname Router or hostname Switch to restore the platform default.", { nextHostname: hostname }),
  step("enable-secret", "security", "global", "enable secret Str0ngEnable!", "Protect Privileged EXEC with an enable secret.", "The enable secret protects the privilege boundary and is stored as a one-way hash on modern IOS releases.", "This lab treats Str0ngEnable! as a case-sensitive training secret. In production, use an organisation-approved unique secret and a supported modern hashing type.", "After saving, leave Privileged EXEC and test that enable requests authentication on a real lab image.", "Replace it with a new enable secret; do not remove the control before a replacement exists.", { sensitiveTokens: [2] }),
  step("password-encryption", "security", "global", "service password-encryption", "Obscure remaining plaintext-style passwords in the configuration.", "This reduces casual exposure in configuration output, but it is not strong cryptographic protection.", "Type 7 obfuscation is reversible. Prefer secret-based commands and secure configuration handling; never treat this command as sufficient password security.", "Inspect the relevant running configuration on a real lab and confirm supported secrets use hashes.", "Use no service password-encryption only if policy explicitly requires it; existing encoded values may remain encoded."),
  step("local-user", "security", "global", "username netadmin privilege 15 secret L0calAdmin!", "Create a privileged local fallback administrator.", "A local account keeps emergency access possible when central authentication is unavailable.", "The username and privilege are IOS configuration values; the secret is case-sensitive. Production access should follow least privilege rather than assigning level 15 by default to every operator.", "Use show running-config | section username on a real lab, then test login through the intended line.", "Create and test a replacement account before using no username netadmin.", { sensitiveTokens: [5] }),
  step("radius-context", "security", "global", "radius server RAD1", "Create the simulated RADIUS server profile RAD1.", "A named server profile groups the address and shared secret used to contact a central identity service.", "This simulator teaches the IOS configuration relationship; it does not send packets or authenticate against a real RADIUS server.", "Later, inspect the AAA and RADIUS configuration and test central authentication on an isolated lab image.", "Remove the AAA references first, then use no radius server RAD1.", { nextMode: "radius" }),
  step("radius-address", "security", "radius", "address ipv4 192.168.50.10 auth-port 1812 acct-port 1813", "Set the RADIUS server address and standard authentication/accounting ports.", "The router needs an IPv4 destination and ports for authentication and accounting requests.", "192.168.50.10 is an easy-to-type private training address. Real deployments also need routing, source-interface policy and reachability to the server.", "Test IP reachability first, then use RADIUS test and debugging only under a controlled change plan.", "Use no address ipv4 192.168.50.10 to remove the endpoint from the profile."),
  step("radius-key", "security", "radius", "key Rad1usLab!", "Set the case-sensitive RADIUS shared secret.", "The shared secret protects attributes exchanged between the network device and RADIUS server; both ends must match exactly.", "This is a simulated training value. Never reuse it in production or store a production RADIUS secret in this repository.", "On a real lab, a mismatched key appears as failed authentication even when IP connectivity works.", "Replace the key on both ends during a coordinated rotation.", { sensitiveTokens: [1] }),
  step("exit-radius", "security", "radius", "exit", "Return to Global Configuration mode.", "The server profile is complete; AAA policy is configured at global scope.", "Reading the prompt prevents placing a valid command in the wrong configuration submode.", "Confirm the prompt ends (config)#.", "Re-enter with radius server RAD1.", { nextMode: "global" }),
  step("aaa-new-model", "security", "global", "aaa new-model", "Enable the AAA policy framework.", "AAA separates authentication, authorisation and accounting policy from individual console or VTY lines.", "Enabling AAA can change access behaviour. Production changes require a tested fallback session and rollback plan to avoid lockout.", "Keep an existing privileged session open while testing a second login on a real lab.", "Use no aaa new-model only from a protected recovery path; removing AAA broadly changes access policy."),
  step("aaa-login", "security", "global", "aaa authentication login default group radius local", "Use RADIUS first and the local database as fallback for login.", "The method list tries central authentication and can fall back to the local account when the server is unavailable.", "Fallback is for RADIUS unavailability, not necessarily for an explicit access rejection. Test the exact platform behaviour before production deployment.", "Test one valid RADIUS user, one local fallback during simulated server loss and one denied user.", "Replace the line authentication method before removing this method list."),
  step("domain", "security", "global", "ip domain name lab.local", "Set the domain name required for RSA key generation.", "IOS uses the hostname and domain name when generating the SSH RSA key identity.", "The lab.local suffix is reserved here as an isolated teaching value; use the organisation's assigned domain in a real environment.", "Use show running-config | include domain on a real lab.", "Use no ip domain name lab.local only after planning the SSH key impact."),
  step("rsa", "security", "global", "crypto key generate rsa modulus 2048", "Generate a 2048-bit RSA key for SSH.", "SSH needs a device key to identify the server and establish encrypted sessions.", "Key-generation support and recommended sizes vary by IOS XE release and security policy. This simulator records the configuration intent without creating a real key.", "Use show crypto key mypubkey rsa on a compatible real lab image.", "Use crypto key zeroize rsa only during a planned key replacement; it interrupts SSH."),
  step("ssh-version", "security", "global", "ip ssh version 2", "Require SSH version 2.", "SSHv2 provides the modern protocol behaviour expected for encrypted remote administration.", "SSH protects the management channel; it does not replace AAA, source restrictions or secure key management.", "Use show ip ssh.", "Use no ip ssh version 2 only when deliberately returning to the platform default."),
  step("vty", "security", "global", "line vty 0 4", "Open the first five virtual terminal lines.", "VTY line configuration controls inbound remote management sessions.", "The range 0–4 is common, but platforms can expose more lines. Audit and configure every available VTY range on the target device.", "Use show line and inspect every VTY range on a real lab.", "Use exit to leave line configuration; remove individual line commands with their no forms.", { nextMode: "line" }),
  step("vty-auth", "security", "line", "login authentication default", "Apply the default AAA login method to VTY access.", "Defining a method list does nothing for these lines until the line references it.", "This links inbound SSH login to the RADIUS-first, local-fallback policy configured earlier.", "Test a second SSH session before closing the recovery session.", "Apply a known-good replacement method list before removing this reference."),
  step("vty-transport", "security", "line", "transport input ssh", "Allow SSH and reject insecure inbound Telnet on these VTY lines.", "SSH encrypts credentials and session data; Telnet does not.", "This controls inbound protocols only. Reachability, ACLs and AAA still determine who can connect and authenticate.", "Use show running-config | section line vty and attempt an SSH connection on a real lab.", "Use transport input all only temporarily in an isolated recovery plan."),
  step("exit-vty", "security", "line", "exit", "Return to Global Configuration mode.", "Line-specific remote-access controls are complete; services and interfaces belong to global or interface scope.", "The prompt is part of the command grammar. A correct keyword in the wrong mode is still the wrong operation.", "Confirm the prompt ends (config)#.", "Re-enter with line vty 0 4.", { nextMode: "global" }),
  step("dns", "services", "global", "ip name-server 1.1.1.1", "Configure a DNS resolver address.", "The device can use a name server when an operator or feature needs hostname-to-address resolution.", "1.1.1.1 is easy to type for this isolated lesson. A real management network normally uses approved internal resolvers and controlled egress.", "Use show hosts and test an approved name on a connected real lab.", "Use no ip name-server 1.1.1.1."),
];

const finishSteps = (device: "router" | "switch"): DeviceBuildStep[] => [
  step("end", "verification", "global", "end", "Return to Privileged EXEC for verification.", "Operational show commands are normally run from an EXEC prompt after configuration is complete.", "The # prompt confirms configuration submode has ended.", "Confirm the prompt ends #.", "Use configure terminal to return to Global Configuration mode.", { nextMode: "privileged" }),
  step("verify-ip", "verification", "privileged", "show ip interface brief", "Verify interface addresses and state in one concise table.", "This view quickly exposes missing addresses, administrative shutdowns and line-protocol faults.", "Read IP-Address, Status and Protocol as separate evidence. Up/up is healthy; administratively down means the interface is disabled by configuration.", "Compare every configured interface with the work order.", "This command is read-only; rollback is not required.", { output: device === "router" ? ["Interface              IP-Address      OK? Method Status                Protocol", "GigabitEthernet0/0/1   192.168.1.1     YES manual up                    up", "TenGigabitEthernet0/1/1 10.1.1.1       YES manual up                    up"] : ["Interface              IP-Address      OK? Method Status                Protocol", "Vlan99                 192.168.99.2    YES manual up                    up"] }),
  step("verify-ssh", "verification", "privileged", "show ip ssh", "Verify the simulated SSH server settings.", "Configuration is not complete until the intended management service state is inspected.", "On a real device, check the enabled version, authentication settings and timeouts, then attempt a separate login.", "Confirm SSH version 2 is enabled.", "This command is read-only; correct the relevant global or line command if output is wrong.", { output: ["SSH Enabled - version 2.0", "Authentication methods: publickey,password,keyboard-interactive"] }),
  step("save", "verification", "privileged", "copy running-config startup-config", "Save the verified running configuration.", "Running configuration is active now; startup configuration is what the device loads after a restart.", "Saving only after verification avoids preserving a known-bad state. It does not replace a versioned external configuration backup.", "Use show startup-config and compare critical sections with the running configuration.", "Restore a known-good configuration through an approved change and save again.", { output: ["Destination filename [startup-config]?", "Building configuration...", "[OK]"] }),
];

const routerSteps: DeviceBuildStep[] = [
  ...sharedOpening("BRANCH-R1"),
  step("dhcp-excluded", "services", "global", "ip dhcp excluded-address 192.168.1.1 192.168.1.20", "Reserve infrastructure addresses so DHCP cannot lease them.", "The router address and a small static range must not be handed to clients.", "Exclusions are configured globally before the pool. Here .1–.20 remain available for the gateway, switches, access points or other fixed hosts.", "Use show running-config | include excluded-address.", "Use no ip dhcp excluded-address 192.168.1.1 192.168.1.20."),
  step("dhcp-pool", "services", "global", "ip dhcp pool USERS", "Create the USERS DHCP pool.", "The pool groups the subnet and client options supplied to hosts.", "Entering DHCP pool mode changes the prompt to (dhcp-config)# and scopes subsequent commands to USERS.", "Use show ip dhcp pool after completing the pool.", "Use no ip dhcp pool USERS to remove the whole pool.", { nextMode: "dhcp" }),
  step("dhcp-network", "services", "dhcp", "network 192.168.1.0 255.255.255.0", "Define the client subnet for the pool.", "The network statement tells the DHCP service which addresses belong to this pool.", "It identifies the network, not an individual host address. /24 is written as 255.255.255.0 in this command.", "Use show ip dhcp pool and confirm the network and utilisation.", "Use no network 192.168.1.0 255.255.255.0."),
  step("dhcp-router", "services", "dhcp", "default-router 192.168.1.1", "Tell DHCP clients to use the router as their default gateway.", "Without a default-router option, clients can reach their local subnet but do not learn where to send remote traffic.", "The option must be an address reachable on the client subnet; it matches the LAN interface configured later.", "Inspect a simulated binding, then verify the leased client received 192.168.1.1 as its gateway.", "Use no default-router 192.168.1.1."),
  step("dhcp-dns", "services", "dhcp", "dns-server 1.1.1.1", "Supply a DNS resolver to DHCP clients.", "Clients need a resolver address to translate hostnames into IP addresses.", "The router's own ip name-server and the DHCP client's dns-server option are separate settings.", "Inspect a client lease and perform an approved name lookup on a real lab.", "Use no dns-server 1.1.1.1."),
  step("exit-dhcp", "services", "dhcp", "exit", "Return to Global Configuration mode.", "The DHCP pool is complete; physical interface configuration has a different scope.", "Prompt awareness prevents trying interface commands inside DHCP pool mode.", "Confirm the prompt ends (config)#.", "Re-enter with ip dhcp pool USERS.", { nextMode: "global" }),
  step("lan-interface", "interfaces", "global", "interface gi0/0/1", "Open the GigabitEthernet LAN interface using its short form.", "gi is the unambiguous IOS abbreviation for GigabitEthernet on this simulated platform.", "Short interface names reduce typing while retaining slot/subslot/port identity. Real hardware numbering must be read from show ip interface brief.", "Confirm the prompt changes to (config-if)#.", "Use exit to leave the interface context.", { nextMode: "interface" }),
  step("lan-description", "interfaces", "interface", "description USERS LAN", "Document the purpose of the LAN interface.", "Descriptions make diagrams, incident response and remote troubleshooting faster.", "Use a consistent description that identifies the connected service or peer without exposing sensitive information.", "Use show interfaces description.", "Use no description."),
  step("lan-address", "interfaces", "interface", "ip address 192.168.1.1 255.255.255.0", "Assign the LAN gateway address.", "This address becomes the default gateway supplied to DHCP clients and installs a connected /24 route when the interface is operational.", "A connected route is derived from interface state; it is not the same configuration object as a static ip route command.", "Use show ip interface brief and show ip route connected.", "Use no ip address after dependent services have been moved."),
  step("lan-up", "interfaces", "interface", "no shutdown", "Administratively enable the LAN interface.", "Router interfaces commonly begin administratively down. no shutdown removes that configured disable state.", "Operational up/up additionally depends on hardware, cabling and the far end; the command alone cannot prove link health.", "Use show ip interface brief and read both Status and Protocol.", "Use shutdown during an approved outage."),
  step("exit-lan", "interfaces", "interface", "exit", "Return to Global Configuration mode.", "The LAN interface is complete and the uplink is a separate interface context.", "Each interface keeps its own address and administrative state.", "Confirm the prompt ends (config)#.", "Re-enter with interface gi0/0/1.", { nextMode: "global" }),
  step("wan-interface", "interfaces", "global", "interface te0/1/1", "Open the TenGigabitEthernet uplink using its short form.", "te identifies a TenGigabitEthernet interface; the transceiver and cabling determine whether the physical medium is fibre or copper.", "Fibre describes media, not a generic IOS interface keyword. Always use the interface family shown by the platform.", "Confirm (config-if)# and the selected interface on a real lab with show interfaces description.", "Use exit to leave the interface context.", { nextMode: "interface" }),
  step("wan-description", "interfaces", "interface", "description CORE UPLINK", "Document the uplink role.", "A useful description helps an engineer map the logical configuration to the physical path.", "CORE UPLINK is intentionally simple; a production standard might include the remote device and port.", "Use show interfaces description.", "Use no description."),
  step("wan-address", "interfaces", "interface", "ip address 10.1.1.1 255.255.255.252", "Assign a small point-to-point uplink subnet.", "A /30 provides two usable IPv4 addresses, suitable for a simple training point-to-point link.", "10.1.1.1/30 has network 10.1.1.0, peer candidate 10.1.1.2 and broadcast 10.1.1.3.", "Use show ip interface brief and ping 10.1.1.2 on a connected lab.", "Use no ip address after routing has been migrated."),
  step("wan-up", "interfaces", "interface", "no shutdown", "Administratively enable the uplink.", "The uplink cannot forward while it is administratively disabled.", "Use operational output to distinguish administrative state from fibre/transceiver/link faults.", "Use show ip interface brief and show interfaces te0/1/1.", "Use shutdown during an approved outage."),
  step("exit-wan", "interfaces", "interface", "exit", "Return to Global Configuration mode.", "Both routed interfaces are now configured; verification belongs at Privileged EXEC.", "The running configuration is still unsaved until the final step.", "Confirm the prompt ends (config)#.", "Re-enter with interface te0/1/1.", { nextMode: "global" }),
  ...finishSteps("router"),
];

const switchSteps: DeviceBuildStep[] = [
  ...sharedOpening("ACCESS-SW1"),
  step("vlan-users", "services", "global", "vlan 10", "Create VLAN 10 for user access ports.", "A VLAN creates a Layer 2 broadcast domain that access and trunk ports can reference.", "IOS keywords are case-insensitive: vlan 10, Vlan 10 and VLAN 10 express the same command. Cisco documentation conventionally shows lowercase.", "Use show vlan brief after naming and assigning access ports.", "Move dependent ports first, then use no vlan 10.", { nextMode: "vlan" }),
  step("name-users", "services", "vlan", "name USERS", "Name VLAN 10 USERS.", "A descriptive VLAN name makes operational output easier to interpret than an ID alone.", "The name is a label; VLAN membership and forwarding still depend on the numeric VLAN ID.", "Use show vlan brief.", "Use no name or replace the name according to platform support."),
  step("exit-users", "services", "vlan", "exit", "Return to Global Configuration mode.", "The user VLAN is complete; management uses a separate VLAN.", "The prompt confirms the scope of the next command.", "Confirm (config)#.", "Re-enter with vlan 10.", { nextMode: "global" }),
  step("vlan-management", "services", "global", "vlan 99", "Create VLAN 99 for switch management.", "Separating management from user access reduces accidental exposure and supports policy boundaries.", "A management VLAN alone is not a security boundary; use ACLs, secure management transport and an isolated management design.", "Use show vlan brief.", "Move the management SVI and trunks before removing VLAN 99.", { nextMode: "vlan" }),
  step("name-management", "services", "vlan", "name MANAGEMENT", "Name VLAN 99 MANAGEMENT.", "Clear labels help operators recognise the intended role during verification and incident response.", "The uppercase label is a chosen name, not a command-capitalisation requirement.", "Use show vlan brief.", "Use no name or replace it."),
  step("exit-management", "services", "vlan", "exit", "Return to Global Configuration mode.", "VLAN definitions are complete; physical ports are configured in interface mode.", "The switch lab intentionally omits a DHCP server pool because endpoint address service is usually centralised elsewhere in this access-layer design.", "Confirm (config)#.", "Re-enter with vlan 99.", { nextMode: "global" }),
  step("fast-access", "interfaces", "global", "interface fa0/0/1", "Open a FastEthernet user access port using fa.", "fa is the short IOS form for FastEthernet. It represents 100 Mb/s-era interfaces still found in older labs and equipment.", "Use the actual interface inventory for a target switch; short forms are only safe when unambiguous.", "Confirm (config-if)#.", "Use exit to leave the interface.", { nextMode: "interface" }),
  step("access-mode", "interfaces", "interface", "switchport mode access", "Force the user port to operate as an access port.", "Static access mode prevents the port from negotiating a trunk and gives it one untagged data VLAN.", "This is appropriate for a normal endpoint-facing port, not an uplink carrying several VLANs.", "Use show interfaces fa0/0/1 switchport.", "Use no switchport mode access or configure the intended replacement mode."),
  step("access-vlan", "interfaces", "interface", "switchport access vlan 10", "Place the access port in VLAN 10.", "Untagged endpoint traffic entering this port is associated with the USERS broadcast domain.", "The VLAN should exist before assignment so verification is predictable.", "Use show vlan brief and show interfaces fa0/0/1 switchport.", "Move the port to the replacement VLAN before removing VLAN 10."),
  step("portfast", "interfaces", "interface", "spanning-tree portfast", "Enable PortFast for the endpoint-facing port.", "PortFast lets an edge port reach forwarding state quickly rather than waiting through normal STP transitions.", "Use it only where no switch or bridge can create a loop. PortFast does not disable spanning tree.", "Use show spanning-tree interface fa0/0/1 detail.", "Use no spanning-tree portfast."),
  step("bpduguard", "interfaces", "interface", "spanning-tree bpduguard enable", "Shut the edge port if it receives a BPDU.", "BPDU Guard protects the topology from an unexpected switch connected to a PortFast edge port.", "A violation can err-disable the port, so monitoring and a recovery procedure are required.", "Use show spanning-tree interface fa0/0/1 detail and inspect err-disable status.", "Remove the cause, then follow the approved recovery process; no spanning-tree bpduguard enable removes the feature."),
  step("access-up", "interfaces", "interface", "no shutdown", "Administratively enable the user port.", "The port must be enabled before a connected endpoint can establish link.", "Operational link still depends on cabling, NIC and speed/duplex compatibility.", "Use show interfaces status.", "Use shutdown during an approved isolation or maintenance action."),
  step("exit-access", "interfaces", "interface", "exit", "Return to Global Configuration mode.", "The endpoint port is complete; the uplink needs trunk behaviour.", "A port's configuration remains scoped to that interface.", "Confirm (config)#.", "Re-enter with interface fa0/0/1.", { nextMode: "global" }),
  step("trunk-interface", "interfaces", "global", "interface gi0/0/1", "Open the GigabitEthernet distribution uplink using gi.", "GigabitEthernet is a common copper or fibre access-switch uplink family depending on its transceiver and port design.", "The IOS interface keyword describes speed/family; the installed medium determines copper or fibre.", "Confirm (config-if)#.", "Use exit to leave the interface.", { nextMode: "interface" }),
  step("trunk-mode", "interfaces", "interface", "switchport mode trunk", "Set the uplink to static trunk mode.", "A trunk carries tagged traffic for multiple VLANs between network devices.", "Static trunking makes the intended role explicit. Native-VLAN and encapsulation details depend on platform and design.", "Use show interfaces trunk.", "Move traffic safely before changing the port away from trunk mode."),
  step("trunk-allowed", "interfaces", "interface", "switchport trunk allowed vlan 10,99", "Restrict the trunk to the user and management VLANs.", "An explicit allowed list reduces unnecessary Layer 2 propagation across the uplink.", "This command replaces the allowed list on many IOS platforms; add/remove forms are safer for incremental production changes.", "Use show interfaces trunk and confirm 10 and 99 are forwarding.", "Restore the approved previous list rather than blindly allowing all VLANs."),
  step("trunk-up", "interfaces", "interface", "no shutdown", "Administratively enable the GigabitEthernet uplink.", "The trunk cannot carry VLAN traffic while disabled.", "Up/up does not prove that the allowed VLAN list or neighbour configuration is correct.", "Use show interfaces trunk and show interfaces status.", "Use shutdown only within a coordinated outage."),
  step("exit-trunk", "interfaces", "interface", "exit", "Return to Global Configuration mode.", "The normal uplink is complete; the next step demonstrates a higher-speed fibre-capable interface family.", "Different Cisco platforms expose different port families and numbering.", "Confirm (config)#.", "Re-enter with interface gi0/0/1.", { nextMode: "global" }),
  step("fibre-interface", "interfaces", "global", "interface fo0/1/1", "Open a FortyGigabitEthernet fibre uplink using fo.", "fo is the short form for FortyGigabitEthernet on platforms that provide it; such ports commonly use optical or direct-attach transceivers.", "There is no generic FiberEthernet IOS keyword. Fibre is the medium; FastEthernet, GigabitEthernet, TenGigabitEthernet and FortyGigabitEthernet are interface families.", "Use show interfaces status and hardware inventory on the named real platform.", "Use exit to leave the interface.", { nextMode: "interface" }),
  step("fibre-description", "interfaces", "interface", "description FIBRE CORE UPLINK", "Document the fibre core uplink.", "The description lets an operator identify the role without tracing the cable first.", "A production label should include the remote device and port according to the site's standard.", "Use show interfaces description.", "Use no description."),
  step("fibre-trunk", "interfaces", "interface", "switchport mode trunk", "Set the fibre uplink to trunk mode.", "The high-speed uplink can carry the switch's required VLANs towards the core.", "Speed and medium do not decide Layer 2 behaviour; the switchport configuration does.", "Use show interfaces trunk.", "Migrate traffic before changing the mode."),
  step("fibre-allowed", "interfaces", "interface", "switchport trunk allowed vlan 10,99", "Allow only VLANs 10 and 99 on the fibre trunk.", "The explicit list keeps the lab's Layer 2 scope clear and verifiable.", "Both sides of a trunk must agree on which VLANs should traverse it.", "Use show interfaces trunk on both ends of a real lab.", "Restore the approved previous list."),
  step("fibre-up", "interfaces", "interface", "no shutdown", "Administratively enable the fibre uplink.", "The interface must be enabled before optics and line protocol can establish.", "If it remains down, inspect transceiver support, light levels, cabling and the far-end configuration.", "Use show interfaces fo0/1/1 and platform transceiver diagnostics.", "Use shutdown during a coordinated outage."),
  step("exit-fibre", "interfaces", "interface", "exit", "Return to Global Configuration mode.", "Physical switching ports are complete; the management SVI now needs its Layer 3 address.", "An SVI is a logical VLAN interface, not another physical fibre or copper port.", "Confirm (config)#.", "Re-enter with interface fo0/1/1.", { nextMode: "global" }),
  step("management-svi", "interfaces", "global", "interface vlan 99", "Open the VLAN 99 switched virtual interface.", "The SVI gives this Layer 2 switch an IP endpoint for management.", "Its line protocol normally depends on VLAN 99 existing and having at least one active forwarding member on the platform.", "Confirm (config-if)#.", "Use exit to leave the SVI.", { nextMode: "interface" }),
  step("management-ip", "interfaces", "interface", "ip address 192.168.99.2 255.255.255.0", "Assign the switch management address.", "Administrators and monitoring systems need a stable address to reach SSH and management services.", "192.168.99.2/24 is the switch; 192.168.99.1 will be the off-subnet gateway.", "Use show ip interface brief.", "Use no ip address after management has migrated."),
  step("management-up", "interfaces", "interface", "no shutdown", "Administratively enable the management SVI.", "The logical interface must not be administratively disabled.", "An enabled SVI can still remain protocol-down if the VLAN has no active forwarding port.", "Use show ip interface brief and show vlan brief together.", "Use shutdown only with an alternate management path."),
  step("exit-svi", "interfaces", "interface", "exit", "Return to Global Configuration mode.", "The SVI address is configured; a Layer 2 switch needs a default gateway for off-subnet management.", "This lab does not enable Layer 3 routing on the access switch.", "Confirm (config)#.", "Re-enter with interface vlan 99.", { nextMode: "global" }),
  step("default-gateway", "interfaces", "global", "ip default-gateway 192.168.99.1", "Set the management default gateway.", "A Layer 2 switch uses this gateway to reply to management stations outside 192.168.99.0/24 when IP routing is disabled.", "On a multilayer switch with ip routing enabled, static or dynamic routing is used instead; ip default-gateway is not the routed equivalent.", "Ping 192.168.99.1, then test from an approved remote management subnet.", "Use no ip default-gateway 192.168.99.1 or replace it with the approved gateway."),
  ...finishSteps("switch"),
];

const definitions: Record<DeviceBuildLabId, DeviceBuildDefinition> = {
  "router-foundation": { id: "router-foundation", number: 2, shortTitle: "Router foundation", title: "Build a secure branch router from defaults", summary: "Identity, local fallback, simulated RADIUS, SSH, DNS, DHCP, routed interfaces, verification and save.", deviceType: "router", steps: routerSteps },
  "switch-foundation": { id: "switch-foundation", number: 3, shortTitle: "Switch foundation", title: "Build a secure access switch from defaults", summary: "Identity, local fallback, simulated RADIUS, SSH, VLANs, edge security, copper and fibre uplinks, management, verification and save.", deviceType: "switch", steps: switchSteps },
};

export const deviceBuildLabs = Object.values(definitions);
export const getDeviceBuildDefinition = (id: DeviceBuildLabId) => definitions[id];

const applyPrior = (id: DeviceBuildLabId, stepIndex: number): DeviceBuildState => {
  const definition = definitions[id];
  let mode: DeviceBuildMode = "user";
  let hostname = definition.deviceType === "router" ? "Router" : "Switch";
  for (const completedStep of definition.steps.slice(0, stepIndex)) {
    mode = completedStep.nextMode ?? mode;
    hostname = completedStep.nextHostname ?? hostname;
  }
  return { version: 1, labId: id, stepIndex, mode, hostname, completed: stepIndex >= definition.steps.length };
};

export const createDeviceBuildState = (id: DeviceBuildLabId): DeviceBuildState => applyPrior(id, 0);

export const restoreDeviceBuildState = (value: unknown): DeviceBuildState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const saved = value as Partial<DeviceBuildState>;
  if (saved.version !== 1 || (saved.labId !== "router-foundation" && saved.labId !== "switch-foundation")) return null;
  const definition = definitions[saved.labId];
  if (!Number.isInteger(saved.stepIndex) || (saved.stepIndex as number) < 0 || (saved.stepIndex as number) > definition.steps.length) return null;
  const rebuilt = applyPrior(saved.labId, saved.stepIndex as number);
  if (saved.mode !== rebuilt.mode || saved.hostname !== rebuilt.hostname || saved.completed !== rebuilt.completed) return null;
  return rebuilt;
};

export const deviceBuildPrompt = (state: DeviceBuildState) => {
  switch (state.mode) {
    case "user": return `${state.hostname}>`;
    case "privileged": return `${state.hostname}#`;
    case "global": return `${state.hostname}(config)#`;
    case "line": return `${state.hostname}(config-line)#`;
    case "interface": return `${state.hostname}(config-if)#`;
    case "radius": return `${state.hostname}(config-radius-server)#`;
    case "dhcp": return `${state.hostname}(dhcp-config)#`;
    case "vlan": return `${state.hostname}(config-vlan)#`;
  }
};

export const getDeviceBuildStep = (state: DeviceBuildState) => definitions[state.labId].steps[state.stepIndex] ?? null;

const tokenise = (input: string) => input.trim().split(/\s+/u);

const commandMatches = (input: string, expected: string, sensitiveTokens: number[] = []) => {
  const actualTokens = tokenise(input);
  const expectedTokens = tokenise(expected);
  if (actualTokens.length !== expectedTokens.length) return false;
  return expectedTokens.every((token, index) => sensitiveTokens.includes(index)
    ? actualTokens[index] === token
    : actualTokens[index]?.toLocaleLowerCase("en-GB") === token.toLocaleLowerCase("en-GB"));
};

export const runDeviceBuildCommand = (state: DeviceBuildState, input: string): DeviceBuildResult => {
  const current = restoreDeviceBuildState(state);
  if (!current) throw new Error("Invalid device build state");
  const lesson = getDeviceBuildStep(current);
  if (!lesson) return { accepted: false, state: current, output: [], explanation: "This guided build is already complete.", useCase: "Review the completed build or restart it from the Labs list.", verification: "All lesson steps have been accepted.", rollback: "Restart only when you want to clear this saved lab position.", errorCode: "COMPLETE" };
  if (!input.trim()) return { accepted: false, state: current, output: [], explanation: "Enter a command at the current prompt.", useCase: lesson.why, verification: lesson.verify, rollback: "No simulated state changed.", errorCode: "EMPTY" };
  if (input.length > 256) return { accepted: false, state: current, output: [], explanation: "The simulator accepts at most 256 characters.", useCase: lesson.why, verification: lesson.verify, rollback: "Oversized input was rejected without changing state.", errorCode: "TOO_LONG" };
  if (current.mode !== lesson.mode) return { accepted: false, state: current, output: [], explanation: `This objective belongs at the ${lesson.mode} prompt, but the saved state is ${current.mode}. Restart the lab if this mismatch persists.`, useCase: lesson.why, verification: lesson.verify, rollback: "No simulated state changed.", errorCode: "WRONG_MODE" };
  if (!commandMatches(input, lesson.command, lesson.sensitiveTokens)) return { accepted: false, state: current, output: ["% Command rejected by the guided learning lab; simulated device state was not changed."], explanation: `That input does not complete the current objective. IOS command keywords are case-insensitive, but passwords and shared secrets must match their case exactly.`, useCase: lesson.why, verification: lesson.verify, rollback: "Rejected input is inert, so no rollback is required.", errorCode: "WRONG_COMMAND" };

  const nextState = applyPrior(current.labId, current.stepIndex + 1);
  return { accepted: true, state: nextState, output: lesson.output ?? [], explanation: lesson.detail, useCase: lesson.why, verification: lesson.verify, rollback: lesson.rollback };
};

export interface DeviceBuildHint {
  heading: string;
  explanation: string;
  example: string | null;
}

export const getDeviceBuildHint = (state: DeviceBuildState, level: 1 | 2): DeviceBuildHint => {
  const lesson = getDeviceBuildStep(state);
  if (!lesson) return { heading: "Build complete", explanation: "Review the completed phases or restart from the Labs list.", example: null };
  return level === 1
    ? { heading: `Think in ${lesson.phase} scope`, explanation: `${lesson.why} You are at ${deviceBuildPrompt(state)}; use the prompt to identify the command family and scope before recalling the exact syntax.`, example: null }
    : { heading: "Worked command with this lab's values", explanation: lesson.detail, example: lesson.command };
};

export const completeDeviceBuildInput = (state: DeviceBuildState, input: string) => {
  const lesson = getDeviceBuildStep(state);
  if (!lesson || !input.trim() || !lesson.command.toLocaleLowerCase("en-GB").startsWith(input.toLocaleLowerCase("en-GB"))) return input;
  return lesson.command;
};

