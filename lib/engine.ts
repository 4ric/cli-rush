import { expandedCommands } from "./expanded-catalogue.ts";

export type CliMode = "user" | "privileged" | "global" | "interface" | "router" | "line" | "vlan" | "acl" | "dhcp";
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

export const commands: Command[] = [...coreCommands, ...expandedCommands];

export const commandById = new Map(commands.map(command => [command.id, command]));
export const modeNames: Record<CliMode, string> = {
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

export type ErrorCode = "EMPTY" | "TOO_LONG" | "WRONG_MODE" | "MISSING_KEYWORD" | "MISSING_ARGUMENT" | "KEYWORD_ORDER" | "EXTRA_INPUT" | "INVALID_IPV4" | "INVALID_MASK" | "MASK_KIND" | "INVALID_INTERFACE" | "WRONG_VALUE" | "VERIFY_NOT_CONFIGURE" | "CONFIGURE_NOT_VERIFY" | "WRONG_OBJECTIVE" | "UNSUPPORTED";
export type Validation = { ok: true; command: Command; input: string } | { ok: false; input: string; code: ErrorCode; message: string };
export const normalise = (input: string) => input.trim().replace(/\s+/g, " ");
export const isIPv4 = (v: string) => { const o=v.split("."); return o.length===4 && o.every(x=>/^\d{1,3}$/.test(x)&&+x>=0&&+x<=255); };
export const isMask = (v: string, zero=false) => { if(!isIPv4(v)) return false; const bits=v.split(".").map(x=>(+x).toString(2).padStart(8,"0")).join(""); return (zero||bits.includes("1")) && /^1*0*$/.test(bits); };
const same = (a:string,b:string) => a.toLowerCase()===b.toLowerCase();
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
  if(same(input,expected.canonical)) return mode===expected.mode?{ok:true,input,command:expected}:{ok:false,input,code:"WRONG_MODE",message:`Correct command, but it belongs in ${modeNames[expected.mode]} mode. The current prompt is ${modeNames[mode]} mode.`};
  const other=catalogue.find(x=>x.id!==expected.id&&same(x.canonical,input));
  if(other) {
    if(other.mode!==mode) return {ok:false,input,code:"WRONG_MODE",message:`That command is valid from ${modeNames[other.mode]} mode, not ${modeNames[mode]} mode.`};
    if(expected.kind==="configuration"&&other.kind==="verification") return {ok:false,input,code:"VERIFY_NOT_CONFIGURE",message:"That verifies state, but this objective requires a configuration change."};
    if(expected.kind==="verification"&&other.kind==="configuration") return {ok:false,input,code:"CONFIGURE_NOT_VERIFY",message:"That changes configuration, but this objective asks you to verify state."};
    return {ok:false,input,code:"WRONG_OBJECTIVE",message:`That is a valid ${other.topic.toLowerCase()} command, but it does not complete this objective.`};
  }
  return syntaxError(input,expected)??{ok:false,input,code:"UNSUPPORTED",message:"This IOS XE learning pack does not support that command for the current objective."};
};

export interface DeviceState { hostname:string; mode:CliMode; selectedInterface:string; ipv4:string|null; mask:string|null; adminUp:boolean; description:string; routes:string[]; startup:string|null; }
export const initialDevice=():DeviceState=>({hostname:"R1",mode:"user",selectedInterface:"GigabitEthernet0/1",ipv4:null,mask:null,adminUp:false,description:"",routes:[],startup:null});
export const prepare=(state:DeviceState, command:Command):DeviceState=>({...state,mode:command.mode});
export const prompt=(s:DeviceState)=>`${s.hostname}${s.mode==="user"?">":s.mode==="privileged"?"#":s.mode==="global"?"(config)#":s.mode==="interface"?"(config-if)#":s.mode==="router"?"(config-router)#":s.mode==="line"?"(config-line)#":s.mode==="vlan"?"(config-vlan)#":s.mode==="acl"?"(config-ext-nacl)#":"(dhcp-config)#"}`;
export const runningConfig=(s:DeviceState)=>[`hostname ${s.hostname}`,"interface GigabitEthernet0/1",s.description?` description ${s.description}`:"",s.ipv4?` ip address ${s.ipv4} ${s.mask}`:"",s.adminUp?" no shutdown":" shutdown",...s.routes,"end"].filter(Boolean).join("\n");
export const applyCommand=(state:DeviceState, command:Command):{state:DeviceState;output:string[]}=>{
  const s:DeviceState=JSON.parse(JSON.stringify(state)); let output:string[]=[];
  switch(command.id){
    case"nav.enable":s.mode="privileged";break; case"nav.disable":s.mode="user";break; case"nav.configure":s.mode="global";break;
    case"config.hostname":s.hostname="Branch-R1";break; case"nav.interface":s.mode="interface";break; case"nav.router":s.mode="router";break;
    case"nav.exit-global":s.mode="privileged";break; case"nav.exit-interface":case"nav.exit-router":s.mode="global";break; case"nav.end-interface":case"nav.end-router":s.mode="privileged";break;
    case"interface.description":s.description="Uplink to SW1";break; case"interface.ipv4":s.ipv4="192.0.2.1";s.mask="255.255.255.0";break;
    case"interface.no-shutdown":s.adminUp=true;output=["%LINK-3-UPDOWN: Interface changed state to up"];break; case"interface.shutdown":s.adminUp=false;break; case"interface.no-ip":s.ipv4=null;s.mask=null;break;
    case"route.default":if(!s.routes.includes(command.canonical))s.routes.push(command.canonical);break; case"config.save":s.startup=runningConfig(s);output=["Building configuration...","[OK]"];break;
    case"show.running":output=runningConfig(s).split("\n");break; case"show.startup":output=s.startup?s.startup.split("\n"):["startup-config is not present in the simulator"];break;
    case"show.ip-interface-brief":output=["Interface              IP-Address      Status                Protocol",`GigabitEthernet0/1   ${(s.ipv4??"unassigned").padEnd(15)} ${s.adminUp?"up                    up":"administratively down down"}`];break;
    case"show.ip-route":output=["Codes: C - connected, S - static",...(s.ipv4?["C    192.0.2.0/24 is directly connected"]:[]),...s.routes.map(x=>`S*   ${x.slice(9)}`)];break;
    case"show.version":output=["IOS XE educational simulator, Version 17.9",`${s.hostname} uptime is 3 days, 4 hours`];break;
    case"tools.ping":output=["!!!!!","Success rate is 100 percent (5/5)"];break; case"tools.traceroute":output=["1 192.0.2.254 1 ms","2 198.51.100.10 3 ms"];break;
  }
  if (command.id.startsWith("nav.line")) s.mode="line";
  if (command.id.startsWith("nav.vlan")) s.mode="vlan";
  if (command.id.startsWith("nav.acl")) s.mode="acl";
  if (command.id.startsWith("nav.dhcp")) s.mode="dhcp";
  if (command.id.startsWith("nav.exit-") && ["line","vlan","acl","dhcp"].some(mode=>command.id.endsWith(mode))) s.mode="global";
  if (command.id.startsWith("nav.end-") && ["line","vlan","acl","dhcp"].some(mode=>command.id.endsWith(mode))) s.mode="privileged";
  return {state:s,output};
};

export const seededOrder=(seed:number,catalogue:Command[]=commands)=>{const a=catalogue.map(x=>x.id);let v=seed||1;for(let i=a.length-1;i>0;i--){v=(v*1664525+1013904223)>>>0;const j=Math.floor((v/4294967296)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
