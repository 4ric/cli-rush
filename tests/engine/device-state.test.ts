import assert from "node:assert/strict";
import test from "node:test";
import {
  executeCliCommand,
  handleCliControl,
  initialDevice,
  prompt,
  restoreDeviceCheckpoint,
  restoreDeviceState,
  runningConfig,
} from "../../lib/engine.ts";

test("navigation uses explicit physical, subinterface and range contexts", () => {
  let router = initialDevice("router-ios-xe");
  router = executeCliCommand(router, "ena").state;
  router = executeCliCommand(router, "conf t").state;
  router = executeCliCommand(router, "int gi0/0/1.20").state;
  assert.equal(prompt(router), "R1(config-subif)#");
  assert.equal(router.context, "subinterface");

  let catalyst = initialDevice("catalyst-l2");
  catalyst = executeCliCommand(catalyst, "enable").state;
  catalyst = executeCliCommand(catalyst, "configure terminal").state;
  catalyst = executeCliCommand(catalyst, "interface range gi1/0/1 - 4").state;
  assert.equal(prompt(catalyst), "SW1(config-if-range)#");
  assert.equal(catalyst.selectedInterfaces.length, 4);
});

test("control-key foundations distinguish abort from execute-and-exit", () => {
  let state = initialDevice("router-ios-xe");
  state = executeCliCommand(executeCliCommand(state, "enable").state, "conf t").state;

  const aborted = handleCliControl(state, "Ctrl+C", "hostname DraftName");
  assert.equal(aborted.executed, false);
  assert.equal(aborted.draft, "");
  assert.equal(prompt(aborted.state), "R1#");

  state = executeCliCommand(executeCliCommand(initialDevice(), "enable").state, "conf t").state;
  const ended = handleCliControl(state, "Ctrl+Z", "hostname Router1");
  assert.equal(ended.executed, true);
  assert.equal(ended.state.hostname, "Router1");
  assert.equal(prompt(ended.state), "Router1#");

  assert.deepEqual(handleCliControl(state, "Ctrl+U", "show ip route").draft, "");
  assert.deepEqual(handleCliControl(state, "Ctrl+W", "show ip route").draft, "show ip ");
});

test("RADIUS, AAA-group and local fallback configuration is stateful and redacted", () => {
  const secret = "<test-value>";
  let state = initialDevice("router-ios-xe");
  for (const command of [
    "enable",
    "configure terminal",
    `username learner privilege 15 secret ${secret}`,
    "aaa new-model",
    "radius server RAD1",
    "address ipv4 198.51.100.20 auth-port 1812 acct-port 1813",
    `key ${secret}`,
    "exit",
    "aaa group server radius RAD-GRP",
    "server name RAD1",
  ]) {
    const result = executeCliCommand(state, command);
    assert.equal(result.accepted, true, `${prompt(state)} ${command}: ${result.output.join(" ")}`);
    state = result.state;
  }
  assert.equal(prompt(state), "R1(config-sg-radius)#");
  state = executeCliCommand(state, "exit").state;
  state = executeCliCommand(state, "aaa authentication login default group RAD-GRP local").state;
  state = executeCliCommand(state, "end").state;
  const central = executeCliCommand(state, "ssh -l centraladmin 192.0.2.1");
  assert.match(central.output.join("\n"), /RADIUS server accepted central user centraladmin/u);
  state = executeCliCommand(state, "configure terminal").state;
  state = executeCliCommand(state, "radius server RAD1").state;
  state = executeCliCommand(state, "shutdown").state;
  state = executeCliCommand(state, "end").state;
  const login = executeCliCommand(state, "ssh -l learner 192.0.2.1");
  assert.equal(login.accepted, true);
  assert.match(login.output.join("\n"), /Local fallback accepted learner/u);
  assert.equal(JSON.stringify(login.state).includes(secret), false);
  assert.equal(runningConfig(login.state).includes(secret), false);
});

test("line passwords retain configured state without plaintext in state, snapshots or show output", () => {
  const secret = "NeverPersist-Line-7";
  let state = initialDevice("router-ios-xe");
  for (const command of [
    "enable",
    "configure terminal",
    "line vty 0 4",
    `password ${secret}`,
    "end",
  ]) {
    const result = executeCliCommand(state, command);
    assert.equal(result.accepted, true, `${prompt(state)} ${command}: ${result.output.join(" ")}`);
    state = result.state;
  }

  assert.equal(state.linePasswordConfigured["vty 0 4"], true);
  assert.deepEqual(state.lineSettings["vty 0 4"], []);
  assert.equal(JSON.stringify(state).includes(secret), false);
  assert.match(runningConfig(state), /line vty 0 4\n password \[redacted\]/u);
  assert.equal(runningConfig(state).includes(secret), false);

  const shown = executeCliCommand(state, "show running-config");
  assert.equal(shown.accepted, true);
  assert.equal(shown.output.join("\n").includes(secret), false);
  assert.match(shown.output.join("\n"), /password \[redacted\]/u);

  state = executeCliCommand(state, "write memory").state;
  state = executeCliCommand(state, "").state;
  assert.equal(JSON.stringify(state).includes(secret), false);
  assert.equal(state.startup?.includes(secret), false);
  assert.equal(state.startupSnapshot?.includes(secret), false);

  state = executeCliCommand(state, "configure terminal").state;
  state = executeCliCommand(state, "line vty 0 4").state;
  state = executeCliCommand(state, "no password").state;
  assert.equal(state.linePasswordConfigured["vty 0 4"], undefined);
  assert.doesNotMatch(runningConfig(state), /password \[redacted\]/u);
});

test("legacy line-password strings are sanitised before deterministic output", () => {
  const secret = "Legacy-Plaintext-Must-Go";
  const legacy = initialDevice("router-ios-xe");
  legacy.context = "privileged";
  legacy.mode = "privileged";
  legacy.lineSettings["vty 0 4"] = [`password ${secret}`, "transport input ssh"];

  assert.equal(runningConfig(legacy).includes(secret), false);
  assert.match(runningConfig(legacy), /password \[redacted\]/u);
  const shown = executeCliCommand(legacy, "show running-config");
  assert.equal(shown.output.join("\n").includes(secret), false);
  assert.equal(JSON.stringify(shown.state).includes(secret), false);
  assert.equal(shown.state.linePasswordConfigured["vty 0 4"], true);
  assert.deepEqual(shown.state.lineSettings["vty 0 4"], ["transport input ssh"]);
});

test("persisted device restoration bounds and sanitises line-password state", () => {
  const secret = "Legacy-Restore-Value";
  const state = initialDevice("router-ios-xe");
  state.lineSettings["vty 0 4"] = [`password ${secret}`, "transport input ssh"];
  const legacy = { ...state } as Partial<typeof state> & Record<string, unknown>;
  delete legacy.linePasswordConfigured;

  const restored = restoreDeviceState(legacy, "router-ios-xe");
  assert.ok(restored);
  assert.equal(restored.linePasswordConfigured["vty 0 4"], true);
  assert.deepEqual(restored.lineSettings["vty 0 4"], ["transport input ssh"]);
  assert.equal(JSON.stringify(restored).includes(secret), false);
  assert.equal(restoreDeviceState(restored, "catalyst-l2"), null);

  const malformedMaps: unknown[] = [
    null,
    [],
    "configured",
    { "vty 0 4": "true" },
    { "vty 4 0": true },
    { "vty 0 9999": true },
    { "not-a-line": true },
    { "vty 0 5": true },
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`vty ${index}`, true])),
  ];
  for (const linePasswordConfigured of malformedMaps) {
    assert.equal(
      restoreDeviceState({ ...state, linePasswordConfigured }),
      null,
      JSON.stringify(linePasswordConfigured)?.slice(0, 80),
    );
  }

  assert.equal(restoreDeviceState({ ...state, unexpectedCredentialState: true }), null);
  assert.equal(restoreDeviceState({ ...state, lineSettings: [] }), null);
});

test("persisted device restoration rejects malformed nested checkpoints", () => {
  const state = initialDevice("router-ios-xe");
  const malformedNested = {
    ...state,
    linePasswordConfigured: "not-a-record",
  };
  assert.equal(restoreDeviceState({
    ...state,
    startupSnapshot: JSON.stringify(malformedNested),
  }), null);
  assert.equal(restoreDeviceState({
    ...state,
    recoveryCheckpoint: "not-json",
  }), null);
});

test("Catalyst range, VLAN, trunk and SVI effects appear in verification output", () => {
  let state = initialDevice("catalyst-l2");
  for (const command of [
    "enable",
    "configure terminal",
    "vlan 10",
    "name DATA",
    "exit",
    "vlan 99",
    "name MANAGEMENT",
    "exit",
    "interface range fa1/0/1 - 4",
    "switchport mode access",
    "switchport access vlan 10",
    "spanning-tree portfast",
    "spanning-tree bpduguard enable",
    "no shutdown",
    "exit",
    "interface po1",
    "switchport mode trunk",
    "switchport trunk allowed vlan 10,99",
    "no shutdown",
    "exit",
    "interface vlan 99",
    "ip address 192.0.2.2 255.255.255.0",
    "no shutdown",
    "end",
  ]) {
    const result = executeCliCommand(state, command);
    assert.equal(result.accepted, true, `${prompt(state)} ${command}: ${result.output.join(" ")}`);
    state = result.state;
  }
  const interfaces = executeCliCommand(state, "show ip interface brief");
  assert.match(interfaces.output.join("\n"), /Vlan99.*192\.0\.2\.2.*up\s+up/u);
  assert.match(executeCliCommand(state, "show vlan brief").output.join("\n"), /10\s+DATA.*FastEthernet1\/0\/1/u);
  assert.match(executeCliCommand(state, "show interfaces trunk").output.join("\n"), /Port-channel1.*10,99/u);
});

test("targeted route removal changes deterministic remote reachability", () => {
  let state = initialDevice("router-ios-xe");
  for (const command of [
    "enable",
    "configure terminal",
    "interface gi0/0/1",
    "ip address 192.168.10.1 255.255.255.0",
    "no shutdown",
    "exit",
    "ip route 0.0.0.0 0.0.0.0 192.0.2.2",
    "end",
  ]) state = executeCliCommand(state, command).state;
  assert.match(executeCliCommand(state, "ping 203.0.113.10").output.join("\n"), /100 percent/u);
  state = executeCliCommand(state, "configure terminal").state;
  state = executeCliCommand(state, "no ip route 0.0.0.0 0.0.0.0 192.0.2.2").state;
  state = executeCliCommand(state, "end").state;
  assert.match(executeCliCommand(state, "ping 203.0.113.10").output.join("\n"), /0 percent/u);
});

test("startup-to-running copy merges saved lines without deleting unrelated unsaved state", () => {
  let state = initialDevice("router-ios-xe");
  for (const command of ["enable", "configure terminal", "hostname SAVED-R1", "end", "write memory"]) {
    const result = executeCliCommand(state, command);
    assert.equal(result.accepted, true, command);
    state = result.state;
  }
  for (const command of ["configure terminal", "hostname UNSAVED-R1", "ip name-server 192.0.2.53", "end"]) {
    state = executeCliCommand(state, command).state;
  }
  const merged = executeCliCommand(state, "copy startup-config running-config");
  assert.equal(merged.accepted, true);
  assert.equal(merged.state.hostname, "SAVED-R1");
  assert.deepEqual(merged.state.nameServers, ["192.0.2.53"]);
  assert.match(merged.output.join("\n"), /merged[\s\S]*Unrelated unsaved/iu);
});

test("broad default and disruptive confirmations retain a restorable checkpoint", () => {
  let state = initialDevice("router-ios-xe");
  for (const command of [
    "enable",
    "configure terminal",
    "interface gi0/0/1",
    "description RECOVERY LINK",
    "exit",
  ]) state = executeCliCommand(state, command).state;

  const pending = executeCliCommand(state, "default interface gi0/0/1");
  assert.equal(pending.state.pendingInteraction?.kind, "default-interface");
  assert.ok(pending.state.recoveryCheckpoint);
  const reset = executeCliCommand(pending.state, "");
  assert.equal(reset.state.interfaces["GigabitEthernet0/0/1"].description, "");
  const restored = restoreDeviceCheckpoint(reset.state);
  assert.equal(restored.accepted, true);
  assert.equal(restored.state.interfaces["GigabitEthernet0/0/1"].description, "RECOVERY LINK");

  state = executeCliCommand(state, "end").state;
  state = executeCliCommand(state, "write memory").state;
  const reload = executeCliCommand(state, "reload");
  assert.ok(reload.state.recoveryCheckpoint);
  const declined = executeCliCommand(reload.state, "no");
  assert.equal(declined.accepted, false);
  assert.equal(declined.state.pendingInteraction, null);
});
