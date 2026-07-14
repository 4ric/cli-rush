import assert from "node:assert/strict";import test from "node:test";
import {
  applyCommand,
  commands,
  executeCliCommand,
  executionSatisfiesLearningObjective,
  initialDevice,
  isIPv4,
  isMask,
  prepare,
  prompt,
  resolveCommand,
  submitCliInteraction,
  validate,
  validateOperational,
  type Command,
} from "../../lib/engine.ts";
test("expanded catalogue preserves the documented baseline",()=>{assert.equal(commands.length,214);assert.equal(new Set(commands.map(x=>x.id)).size,214);assert.equal(new Set(commands.map(x=>x.canonical.toLowerCase())).size,203);assert.equal(new Set(commands.map(x=>x.mode)).size,9);assert.equal(new Set(commands.map(x=>x.topic)).size,25);});
test("every canonical command validates in its declared mode",async t=>{for(const command of commands)await t.test(command.id,()=>assert.equal(validate(command.canonical,command.mode,command.id).ok,true));});
test("case and whitespace are normalised",()=>assert.equal(validate("  SHOW   IP interface BRIEF ","privileged","show.ip-interface-brief").ok,true));
test("IOS VLAN keywords accept lowercase, capitalised and uppercase forms",()=>{for(const input of ["vlan 20","Vlan 20","VLAN 20"])assert.equal(validate(input,"global","nav.vlan-20").ok,true);});
test("Field CLI accepts only unambiguous keyword abbreviations and exact values",()=>{assert.equal(validateOperational("sh ip int br","privileged","show.ip-interface-brief").ok,true);assert.equal(validate("sh ip int br","privileged","show.ip-interface-brief").ok,false);assert.equal(validateOperational("ip add 192.0.2.1 255.255.255.0","interface","interface.ipv4").ok,true);assert.equal(validateOperational("ip add 192.0.2.99 255.255.255.0","interface","interface.ipv4").ok,false);assert.equal(validateOperational("sh ip","privileged","show.ip-route").ok,false);});
test("wrong modes are rejected specifically",()=>{const r=validate("show running-config","global","show.running");assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,"WRONG_MODE");});
test("missing, reordered and extra keywords are distinguished",()=>{for(const [input,code] of [["show ip interface","MISSING_KEYWORD"],["terminal configure","KEYWORD_ORDER"],["show ip interface brief now","EXTRA_INPUT"]]){const r=validate(input,"privileged",input.includes("configure")?"nav.configure":"show.ip-interface-brief");assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,code);}});
test("IPv4 and subnet mask rules are deterministic",()=>{assert.equal(isIPv4("192.0.2.255"),true);assert.equal(isIPv4("192.0.2.300"),false);assert.equal(isMask("255.255.255.0"),true);assert.equal(isMask("255.0.255.0"),false);for(const [input,code] of [["ip address 192.0.2.300 255.255.255.0","INVALID_IPV4"],["ip address 192.0.2.1 255.0.255.0","INVALID_MASK"],["ip address 192.0.2.1 0.0.0.255","MASK_KIND"]]){const r=validate(input,"interface","interface.ipv4");assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,code);}});
test("valid commands for the wrong objective are rejected",()=>{const r=validate("show running-config","privileged","config.save");assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,"VERIFY_NOT_CONFIGURE");});
test("shell-like text remains unsupported and inert",()=>{const r=validate("$(touch /tmp/cli-rush)","user","nav.enable");assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,"UNSUPPORTED");});
test("mode transitions and hostname changes update prompts",()=>{let s=initialDevice();let r=validate("enable",s.mode,"nav.enable");assert.equal(r.ok,true);if(!r.ok)return;s=applyCommand(s,r.command).state;assert.equal(prompt(s),"R1#");s=prepare(s,commands.find(x=>x.id==="config.hostname")!);r=validate("hostname Branch-R1",s.mode,"config.hostname");assert.equal(r.ok,true);if(!r.ok)return;s=applyCommand(s,r.command).state;assert.equal(prompt(s),"Branch-R1(config)#");});
test("interface state is cloned and changed only by accepted commands",()=>{const initial=initialDevice(),item=commands.find(x=>x.id==="interface.ipv4")!,s=prepare(initial,item),r=validate(item.canonical,s.mode,item.id);assert.equal(r.ok,true);if(!r.ok)return;const changed=applyCommand(s,r.command).state;assert.equal(initial.ipv4,null);assert.equal(changed.ipv4,"192.0.2.1");});

test("IOS abbreviations resolve from the complete current-context tree", () => {
  assert.equal(resolveCommand("ena", "user").status, "valid");
  assert.equal(resolveCommand("conf t", "privileged").status, "valid");
  assert.equal(resolveCommand("sh ip int br", "privileged").status, "valid");
  assert.equal(resolveCommand("no shut", "interface").status, "valid");
  assert.equal(resolveCommand("copy run start", "privileged").status, "valid");
  assert.equal(resolveCommand("wr", "privileged").status, "valid");
  assert.equal(resolveCommand("write", "privileged").status, "valid");
  assert.equal(resolveCommand("write memory", "privileged").status, "valid");
});

test("profile interface inventory normalises long and short names", () => {
  const short = resolveCommand("int gi0/0/1", "global", commands, "router-ios-xe");
  const full = resolveCommand("interface GigabitEthernet0/0/1", "global", commands, "router-ios-xe");
  assert.equal(short.status, "valid");
  assert.equal(full.status, "valid");
  if (short.status === "valid" && full.status === "valid") {
    assert.equal(short.event.normalisedArguments.interface, "GigabitEthernet0/0/1");
    assert.equal(full.event.normalisedArguments.interface, "GigabitEthernet0/0/1");
  }
  assert.equal(
    resolveCommand("interface FastEthernet9/9/9", "global", commands, "router-ios-xe").status,
    "invalid",
  );
});

test("wrong-case secrets remain valid IOS syntax but do not satisfy the seeded objective", () => {
  const seededSecret = "Str0ngEnable!";
  const wrongCase = seededSecret.replace("S", "s");
  const secretObjective = {
    ...commands.find((command) => command.id === "config.enable-secret")!,
    id: "test.enable-secret",
    canonical: `enable secret ${seededSecret}`,
  };
  const syntax = resolveCommand(
    `enable secret ${wrongCase}`,
    "global",
    [secretObjective],
    "router-ios-xe",
  );
  assert.equal(syntax.status, "valid");
  const objective = validateOperational(
    `enable secret ${wrongCase}`,
    "global",
    secretObjective.id,
    [secretObjective],
    "router-ios-xe",
  );
  assert.equal(objective.ok, false);
  if (!objective.ok) assert.equal(objective.code, "WRONG_VALUE");
});

test("stateful execution preserves context for do and confirms saves interactively", () => {
  let state = initialDevice("router-ios-xe");
  state = executeCliCommand(state, "enable").state;
  state = executeCliCommand(state, "configure terminal").state;
  state = executeCliCommand(state, "interface gi0/0/1").state;
  state = executeCliCommand(state, "ip address 192.0.2.1 255.255.255.0").state;
  state = executeCliCommand(state, "no shutdown").state;

  const inspected = executeCliCommand(state, "do show ip interface brief");
  assert.equal(inspected.accepted, true);
  assert.equal(prompt(inspected.state), "R1(config-if)#");
  assert.match(inspected.output.join("\n"), /GigabitEthernet0\/0\/1.*192\.0\.2\.1.*up\s+up/u);

  state = executeCliCommand(inspected.state, "end").state;
  const saving = executeCliCommand(state, "copy run start");
  assert.equal(saving.accepted, true);
  assert.equal(saving.state.startup, null);
  assert.match(saving.output.join("\n"), /Destination filename \[startup-config\]\?/u);
  const confirmed = submitCliInteraction(saving.state, "");
  assert.equal(confirmed.accepted, true);
  assert.match(confirmed.state.startup ?? "", /192\.0\.2\.1/u);
});

test("semantic task evaluation accepts completed save alternatives but not a pending or stale save", () => {
  const save = commands.find((command) => command.id === "config.save")!;
  let privileged = executeCliCommand(initialDevice(), "enable").state;

  const pending = executeCliCommand(privileged, "copy run start");
  assert.equal(executionSatisfiesLearningObjective(save, privileged, pending), false);
  const confirmed = submitCliInteraction(pending.state, "");
  assert.equal(executionSatisfiesLearningObjective(save, pending.state, confirmed), true);

  privileged = executeCliCommand(initialDevice(), "enable").state;
  const written = executeCliCommand(privileged, "wr");
  assert.equal(written.state.pendingInteraction, null);
  assert.match(written.output.join("\n"), /\[OK\]/u);
  assert.equal(executionSatisfiesLearningObjective(save, privileged, written), true);

  const unrelated = executeCliCommand(written.state, "show version");
  assert.equal(executionSatisfiesLearningObjective(save, written.state, unrelated), false);
});

test("preparing a question selects the command's supported virtual-device profile", () => {
  const switchCommand = commands.find((command) => command.canonical === "switchport mode access")!;
  const switchState = prepare(initialDevice("router-ios-xe"), switchCommand);
  assert.equal(switchState.profileId, "catalyst-l2");
  assert.equal(switchState.hostname, "SW1");
  assert.equal(switchState.mode, switchCommand.mode);

  const routerCommand = commands.find((command) => command.id === "route.default")!;
  const routerState = prepare(switchState, routerCommand);
  assert.equal(routerState.profileId, "router-ios-xe");
  assert.equal(routerState.hostname, "R1");

  const declaredCustom: Command = {
    id: "custom.profiletest",
    mode: "privileged",
    canonical: "show parser profile",
    objective: "Inspect a profile-specific simulator value.",
    explanation: "Read-only test content.",
    topic: "Custom",
    kind: "verification",
    difficulty: 1,
    custom: true,
    deviceProfile: "catalyst-l2",
  };
  assert.equal(prepare(routerState, declaredCustom).profileId, "catalyst-l2");
});

test("every advertised show command returns deterministic read-only evidence", () => {
  const inspections = commands.filter((command) => command.canonical.toLocaleLowerCase("en-GB").startsWith("show "));
  assert.ok(inspections.length >= 70);
  for (const command of inspections) {
    const before = prepare(initialDevice(), command);
    const snapshot = JSON.stringify(before);
    const result = executeCliCommand(before, command.canonical);
    assert.equal(result.accepted, true, command.id);
    assert.ok(result.output.length > 0, `${command.id} returned no evidence`);
    assert.ok(result.output.every((line) => line.trim().length > 0), `${command.id} returned a blank line`);
    assert.equal(JSON.stringify(result.state), snapshot, `${command.id} changed device state`);
  }
});

test("every built-in learning objective is executable from its seeded prepared state", () => {
  for (const command of commands) {
    const before = prepare(initialDevice(), command);
    let execution = executeCliCommand(before, command.canonical);
    assert.equal(execution.accepted, true, command.id);
    let completed = executionSatisfiesLearningObjective(command, before, execution);

    if (execution.state.pendingInteraction) {
      assert.equal(completed, false, `${command.id} completed before confirmation`);
      const pending = execution.state;
      execution = executeCliCommand(pending, "");
      assert.equal(execution.accepted, true, `${command.id} confirmation`);
      completed = executionSatisfiesLearningObjective(command, pending, execution);
    }

    assert.equal(completed, true, `${command.id} did not satisfy its semantic objective`);
  }
});

test("failed reachability output does not satisfy a successful ping objective", () => {
  const command = commands.find((candidate) => candidate.id === "tools.ping")!;
  const unprepared = { ...initialDevice(), context: "user" as const };
  const execution = executeCliCommand(unprepared, command.canonical);
  assert.equal(execution.accepted, true);
  assert.match(execution.output.join("\n"), /Success rate is 0 percent/u);
  assert.equal(executionSatisfiesLearningObjective(command, unprepared, execution), false);
});
