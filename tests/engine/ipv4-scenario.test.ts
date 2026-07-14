import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelIpv4ScenarioPendingInteraction,
  completeIpv4ScenarioInput,
  createIpv4Scenario,
  getIpv4ScenarioCatalogue,
  getIpv4ScenarioChoices,
  getIpv4ScenarioCliHelp,
  getIpv4ScenarioHint,
  getIpv4ScenarioObjective,
  ipv4ScenarioPrompt,
  restoreIpv4ScenarioCheckpoint,
  restoreIpv4ScenarioState,
  runIpv4ScenarioCommand,
  submitIpv4ScenarioInterpretation,
  type Ipv4ScenarioActionResult,
  type Ipv4ScenarioChoiceId,
  type Ipv4ScenarioState,
} from "../../lib/ipv4-scenario.ts";

const run = (
  state: Ipv4ScenarioState,
  input: string,
  accepted = true,
): Ipv4ScenarioActionResult => {
  const result = runIpv4ScenarioCommand(state, input);
  assert.equal(result.accepted, accepted, `${ipv4ScenarioPrompt(state)} ${input}: ${result.explanation}`);
  if (accepted) {
    assert.equal(result.valid, true);
    assert.ok(result.explanation.length > 30);
    assert.ok(result.useCase.length > 30);
    assert.ok(result.verification.length > 20);
    assert.ok(result.rollback.length > 20);
    assert.ok(result.nextObjective.length > 20);
  }
  return result;
};

const choose = (state: Ipv4ScenarioState, choice: Ipv4ScenarioChoiceId) => {
  const result = submitIpv4ScenarioInterpretation(state, choice);
  assert.equal(result.accepted, true, result.explanation);
  return result;
};

/** Reach every boundary of the exact twenty-six-action flow and retain its results. */
const completeFlow = (seed = 73) => {
  let state = createIpv4Scenario(seed);
  const p = state.parameters;
  const results: Ipv4ScenarioActionResult[] = [];
  const command = (input: string) => {
    const result = run(state, input);
    results.push(result);
    state = result.state;
    return result;
  };

  command("enable"); // 1
  command("show ip interface brief"); // 2
  command(`show running-config interface ${p.interfaceName}`); // 3
  command("configure terminal"); // 4
  command(`interface ${p.interfaceName}`); // 5
  command(`description ${p.description}`); // 6
  command(`ip address ${p.localAddress} ${p.subnetMask}`); // 7
  command("no shutdown"); // 8
  command("end"); // 9
  command("show ip interface brief"); // 10
  command("show ip route connected"); // 11
  command(`ping ${p.localPeer}`); // 12
  command(`ping ${p.remoteTarget}`); // 13
  command("show ip route"); // step 14 command/evidence
  const diagnosis = choose(state, "missing-default-route");
  results.push(diagnosis);
  state = diagnosis.state; // 14 complete
  command("configure terminal"); // 15
  command(`ip route 0.0.0.0 0.0.0.0 ${p.gateway}`); // 16
  command("do show ip route"); // 17
  command(`do ping ${p.remoteTarget}`); // 18
  command(`no ip route 0.0.0.0 0.0.0.0 ${p.gateway}`); // 19
  command(`do ping ${p.remoteTarget}`); // 20
  command(`ip route 0.0.0.0 0.0.0.0 ${p.gateway}`); // 21
  command("do show ip route"); // 22
  command(`do ping ${p.remoteTarget}`); // 23
  command("end"); // 24
  command("copy running-config startup-config"); // 25
  command(""); // 26 / Enter confirmation
  return { state, results };
};

test("seeded work orders are deterministic, private/documentation-only and quick to type", () => {
  const first = createIpv4Scenario(73);
  assert.deepEqual(createIpv4Scenario(73), first);
  assert.equal(first.version, 4);
  assert.equal(ipv4ScenarioPrompt(first), "R1>");
  assert.equal(first.phase, "gain-privilege");
  assert.match(getIpv4ScenarioObjective(first), /Step 1 of 26/iu);

  const states = Array.from({ length: 12 }, (_, index) => createIpv4Scenario(index + 1));
  assert.ok(states.every((state) => /^(?:fa|gi|te)\d+\/\d+\/\d+$/u.test(state.parameters.interfaceName)));
  assert.ok(states.every((state) => /^(?:10\.|192\.168\.)/u.test(state.parameters.localAddress)));
  assert.ok(states.every((state) => state.parameters.wanAddress === "192.0.2.1"));
  assert.ok(states.every((state) => state.parameters.remoteTarget === "203.0.113.10"));
  assert.ok(states.some((state) => state.parameters.interfaceName !== first.parameters.interfaceName));
});

test("the exact twenty-six-action configure, diagnose, remove, recover and save lifecycle is stateful", () => {
  const { state, results } = completeFlow(73);
  const p = state.parameters;
  assert.equal(state.phase, "complete");
  assert.equal(state.acceptedActions, 26);
  assert.equal(state.subActionIndex, 0);
  assert.equal(state.defaultRoute, p.gateway);
  assert.deepEqual(state.startup?.interfaceState, state.interfaceState);
  assert.equal(state.startup?.defaultRoute, p.gateway);
  assert.equal(state.startup?.savedAtAction, 26);
  assert.match(state.startup?.configuration ?? "", /ip route 0\.0\.0\.0 0\.0\.0\.0/u);
  assert.match(getIpv4ScenarioObjective(state), /Lab complete/iu);

  const joined = results.flatMap((result) => result.output).join("\n");
  assert.match(joined, /administratively down/iu);
  assert.match(joined, new RegExp(p.localAddress.replaceAll(".", "\\."), "u"));
  assert.match(joined, /C\s+.*directly connected/iu);
  assert.match(joined, /L\s+.*\/32/iu);
  assert.match(joined, /No default route matches/iu);
  assert.match(joined, /S\*\s+0\.0\.0\.0\/0/iu);
  assert.match(joined, /ARP and the deterministic remote return path are present/iu);
  assert.match(joined, /Building configuration/iu);
  assert.match(joined, /\[OK\]/u);
});

test("every learner-visible IPv4 step is one terminal action", () => {
  let state = createIpv4Scenario(31);
  const p = state.parameters;
  const beforeRepair = [
    "enable", "show ip interface brief", `show running-config interface ${p.interfaceName}`,
    "configure terminal", `interface ${p.interfaceName}`, `description ${p.description}`,
    `ip address ${p.localAddress} ${p.subnetMask}`, "no shutdown", "end",
    "show ip interface brief", "show ip route connected", `ping ${p.localPeer}`,
    `ping ${p.remoteTarget}`, "show ip route",
  ];
  for (const input of beforeRepair) state = run(state, input).state;
  state = choose(state, "missing-default-route").state;
  assert.equal(state.acceptedActions, 14);

  state = run(state, "conf t").state;
  assert.equal(state.acceptedActions, 15);
  assert.equal(state.subActionIndex, 0);
  assert.equal(state.phase, "install-default-route");
  assert.match(getIpv4ScenarioObjective(state), /Step 16 of 26/iu);
  state = run(state, `ip rou 0.0.0.0 0.0.0.0 ${p.gateway}`).state;
  assert.equal(state.acceptedActions, 16);
});

test("route-table interpretation is required and unsupported conclusions do not mutate state", () => {
  let state = createIpv4Scenario(10);
  const p = state.parameters;
  const commands = [
    "enable", "show ip interface brief", `show running-config interface ${p.interfaceName}`,
    "configure terminal", `interface ${p.interfaceName}`, `description ${p.description}`,
    `ip address ${p.localAddress} ${p.subnetMask}`, "no shutdown", "end",
    "show ip interface brief", "show ip route connected", `ping ${p.localPeer}`,
    `ping ${p.remoteTarget}`, "show ip route",
  ];
  for (const input of commands) state = run(state, input).state;
  assert.equal(state.phase, "diagnose-routing-fault");
  assert.equal(getIpv4ScenarioChoices(state).length, 4);

  const blocked = runIpv4ScenarioCommand(state, "configure terminal");
  assert.equal(blocked.errorCode, "INTERPRETATION_REQUIRED");
  assert.deepEqual(blocked.state, state);
  const wrong = submitIpv4ScenarioInterpretation(state, "dns-fault");
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.errorCode, "WRONG_INTERPRETATION");
  assert.deepEqual(wrong.state, state);
});

test("IOS keyword abbreviations, short interface aliases and do execution share the registry", () => {
  let state = createIpv4Scenario(3);
  const p = state.parameters;
  const inputs = [
    "en", "sh ip int br", `sh run int ${p.interfaceName}`, "conf t", `int ${p.interfaceName}`,
    `desc ${p.description}`, `ip add ${p.localAddress} ${p.subnetMask}`, "no sh", "end",
    "sh ip int br", "sh ip rou c", `ping ${p.localPeer}`, `ping ${p.remoteTarget}`, "sh ip rou",
  ];
  for (const input of inputs) state = run(state, input).state;
  state = choose(state, "missing-default-route").state;
  state = run(state, "conf t").state;
  state = run(state, `ip rou 0.0.0.0 0.0.0.0 ${p.gateway}`).state;
  const verification = run(state, "do sh ip rou");
  assert.match(verification.output.join("\n"), /S\*\s+0\.0\.0\.0\/0/u);
  assert.equal(verification.state.mode, "global");
});

test("Tab and ? use state-specific grammar without filling variable values", () => {
  const state = { ...createIpv4Scenario(2), mode: "global" as const };
  const tab = completeIpv4ScenarioInput(state, "do sh ip r");
  assert.equal(tab.changed, true);
  assert.equal(tab.input, "do sh ip route");
  assert.equal(tab.assisted, true);

  const variable = completeIpv4ScenarioInput(state, "ip route 0");
  assert.equal(variable.changed, false);
  assert.match(variable.message, /variable|syntax/iu);

  const help = getIpv4ScenarioCliHelp(state, "do show ip route ");
  assert.ok(help.options.some((option) => option.value === "<cr>"));
  assert.equal(help.hiddenOptions, 0);
  assert.ok(getIpv4ScenarioCatalogue(state).length >= 203);
});

test("three-stage help reasons first, shows shape second and reveals exact input last", () => {
  let state = createIpv4Scenario(1);
  const first = getIpv4ScenarioHint(state, 1);
  assert.equal(first.example, null);
  assert.equal(first.revealed, false);
  assert.match(first.explanation, /prompt|context/iu);
  const shape = getIpv4ScenarioHint(state, 2);
  assert.equal(shape.example, null);
  assert.equal(shape.revealed, false);
  assert.match(shape.explanation, /shape/iu);
  const reveal = getIpv4ScenarioHint(state, 3);
  assert.equal(reveal.example, "enable");
  assert.equal(reveal.revealed, true);

  state = { ...state, phase: "remove-default-route", acceptedActions: 18, mode: "global" };
  const routeShape = getIpv4ScenarioHint(state, 2);
  assert.ok((routeShape.breakdown?.length ?? 0) >= 5);
  assert.match(routeShape.explanation, /0\.0\.0\.0/iu);
  const routeReveal = getIpv4ScenarioHint(state, 3);
  assert.match(routeReveal.example ?? "", /^no ip route 0\.0\.0\.0 0\.0\.0\.0/u);
});

test("valid unrelated exploration executes without advancing or a lab penalty", () => {
  const initial = run(createIpv4Scenario(4), "enable").state;
  const result = run(initial, "show version", false);
  assert.equal(result.valid, true);
  assert.equal(result.category, "valid-unrelated");
  assert.equal(result.errorCode, "VALID_UNRELATED");
  assert.equal(result.state.acceptedActions, initial.acceptedActions);
  assert.equal(result.state.phase, initial.phase);
  assert.match(result.output.join("\n"), /IOS XE educational simulator/iu);
});

test("interface and route output are derived from simulated state", () => {
  let state = createIpv4Scenario(7);
  const p = state.parameters;
  state = run(state, "enable").state;
  let result = run(state, "show ip interface brief");
  assert.match(result.output.join("\n"), /unassigned.*administratively down/iu);
  state = result.state;
  state = run(state, `show running-config interface ${p.interfaceName}`).state;
  state = run(state, "configure terminal").state;
  state = run(state, `interface ${p.interfaceName}`).state;
  state = run(state, `description ${p.description}`).state;
  state = run(state, `ip address ${p.localAddress} ${p.subnetMask}`).state;
  state = run(state, "no shutdown").state;
  state = run(state, "end").state;
  result = run(state, "show ip interface brief");
  assert.match(result.output.join("\n"), new RegExp(`${p.localAddress.replaceAll(".", "\\.")}.*up\\s+up`, "iu"));
  state = result.state;
  result = run(state, "show ip route connected");
  assert.match(result.output.join("\n"), new RegExp(`C\\s+${p.networkAddress.replaceAll(".", "\\.")}\\/24`, "u"));
  assert.match(result.output.join("\n"), new RegExp(`L\\s+${p.localAddress.replaceAll(".", "\\.")}\\/32`, "u"));
});

test("ping failures identify administrative, physical, addressing, route, ARP and return-path causes", () => {
  const completed = completeFlow(9).state;
  const p = completed.parameters;
  const base: Ipv4ScenarioState = {
    ...completed,
    phase: "verify-recovered-remote",
    acceptedActions: 22,
    subActionIndex: 0,
    mode: "global",
    pendingConfirmation: null,
    pendingConfirmationAdvances: false,
    startup: null,
  };
  const cases: Array<[string, Partial<Ipv4ScenarioState>, RegExp]> = [
    ["administrative", { wanInterfaceState: { ...base.wanInterfaceState, adminUp: false } }, /administratively down/iu],
    ["physical", { wanInterfaceState: { ...base.wanInterfaceState, physicalUp: false } }, /physical carrier/iu],
    ["address missing", { wanInterfaceState: { ...base.wanInterfaceState, address: null, mask: null } }, /no complete IPv4 address/iu],
    ["bad WAN plan", { wanInterfaceState: { ...base.wanInterfaceState, address: "198.51.100.1", mask: "255.255.255.252" } }, /address or mask is incorrect/iu],
    ["missing route", { defaultRoute: null }, /No default route matches/iu],
    ["unreachable next hop", { defaultRoute: "198.51.100.2" }, /not reachable through the connected WAN subnet/iu],
    ["missing ARP", { arpNextHopPresent: false }, /ARP cannot resolve/iu],
    ["missing return", { remoteReturnPathPresent: false }, /return path is missing/iu],
  ];
  for (const [name, change, pattern] of cases) {
    const state = { ...base, ...change };
    const result = runIpv4ScenarioCommand(state, `do ping ${p.remoteTarget}`);
    assert.match(result.output.join("\n"), pattern, name);
  }
});

test("exact no-form removal preserves connected and local routes", () => {
  const { state: completed } = completeFlow(12);
  const state: Ipv4ScenarioState = {
    ...completed,
    phase: "verify-remote-failure",
    acceptedActions: 19,
    subActionIndex: 0,
    mode: "global",
    defaultRoute: null,
    pendingConfirmation: null,
    pendingConfirmationAdvances: false,
    startup: null,
  };
  const route = run(state, "do show ip route", false);
  const output = route.output.join("\n");
  assert.match(output, /Gateway of last resort is not set/iu);
  assert.doesNotMatch(output, /S\*\s+0\.0\.0\.0\/0/u);
  assert.match(output, /C\s+/u);
  assert.match(output, /L\s+/u);
});

test("version 4 persistence round-trips, safely migrates legacy envelopes and rejects tamper", () => {
  const configured = completeFlow(31).state;
  assert.deepEqual(restoreIpv4ScenarioState(JSON.parse(JSON.stringify(configured))), configured);

  const legacy = {
    seed: 31,
    hostname: "R1",
    phase: "gain-privilege",
    acceptedActions: 0,
    parameters: { interfaceName: "gi0/0/1" },
  };
  const migrated = restoreIpv4ScenarioState(legacy);
  assert.equal(migrated?.version, 4);
  assert.equal(migrated?.phase, "gain-privilege");
  assert.match(migrated?.migrationNotice ?? "", /safely restarted/iu);

  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { (value.parameters as Record<string, unknown>).gateway = "10.0.0.254"; },
    (value) => { value.acceptedActions = 3; },
    (value) => { (value.interfaceState as Record<string, unknown>).address = "999.1.1.1"; },
    (value) => { value.pendingConfirmation = "save-startup"; },
    (value) => { value.selectedInterface = "GigabitEthernet9/9/9"; },
  ];
  for (const mutate of mutations) {
    const tampered = JSON.parse(JSON.stringify(configured)) as Record<string, unknown>;
    mutate(tampered);
    assert.equal(restoreIpv4ScenarioState(tampered), null);
  }
});

test("version 2 sessions migrate to the recovery-safe state without trusting new fields", () => {
  const current = completeFlow(31).state;
  const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  legacy.version = 2;
  legacy.acceptedActions = 20;
  delete legacy.pendingInterface;
  delete legacy.recoveryCheckpoint;
  const migrated = restoreIpv4ScenarioState(legacy);
  assert.ok(migrated);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.phase, current.phase);
  assert.equal(migrated.recoveryCheckpoint, null);
  assert.match(migrated.migrationNotice ?? "", /recovery-safe/iu);
});

test("exploratory save and reload are interactive, persistent and never advance the twenty-six-step flow", () => {
  const state = run(createIpv4Scenario(41), "enable").state;
  const learningPosition = { phase: state.phase, acceptedActions: state.acceptedActions, subActionIndex: state.subActionIndex };
  const savePrompt = run(state, "copy running-config startup-config", false);
  assert.equal(savePrompt.valid, true);
  assert.equal(savePrompt.awaitingConfirmation, true);
  assert.equal(savePrompt.state.pendingConfirmation, "save-startup");
  const wrong = run(savePrompt.state, "wrong-name", false);
  assert.equal(wrong.state.pendingConfirmation, "save-startup");
  const saved = run(wrong.state, "", false);
  assert.ok(saved.state.startup);
  assert.equal(saved.state.pendingConfirmation, null);
  assert.deepEqual(
    { phase: saved.state.phase, acceptedActions: saved.state.acceptedActions, subActionIndex: saved.state.subActionIndex },
    learningPosition,
  );

  const reloadPrompt = run(saved.state, "reload", false);
  assert.equal(reloadPrompt.awaitingConfirmation, true);
  assert.equal(reloadPrompt.state.pendingConfirmation, "reload");
  assert.ok(reloadPrompt.state.recoveryCheckpoint);
  assert.deepEqual(restoreIpv4ScenarioState(JSON.parse(JSON.stringify(reloadPrompt.state))), reloadPrompt.state);
  const declined = run(reloadPrompt.state, "no", false);
  assert.equal(declined.valid, true);
  assert.equal(declined.state.pendingConfirmation, null);
  assert.equal(declined.state.mode, "privileged");

  const confirmed = run(run(declined.state, "reload", false).state, "", false);
  assert.equal(confirmed.valid, true);
  assert.equal(confirmed.state.mode, "user");
  assert.deepEqual(
    { phase: confirmed.state.phase, acceptedActions: confirmed.state.acceptedActions, subActionIndex: confirmed.state.subActionIndex },
    learningPosition,
  );
  const restored = restoreIpv4ScenarioCheckpoint(confirmed.state);
  assert.equal(restored.valid, true);
  assert.equal(restored.accepted, false);
  assert.equal(restored.state.mode, "privileged");
  assert.equal(restored.state.recoveryCheckpoint, null);
  assert.deepEqual(
    { phase: restored.state.phase, acceptedActions: restored.state.acceptedActions, subActionIndex: restored.state.subActionIndex },
    learningPosition,
  );
});

test("default-interface and erase confirmations retain a restorable bounded checkpoint", () => {
  let state = createIpv4Scenario(51);
  const p = state.parameters;
  const inputs = [
    "enable", "show ip interface brief", `show running-config interface ${p.interfaceName}`,
    "configure terminal", `interface ${p.interfaceName}`, `description ${p.description}`,
  ];
  for (const input of inputs) state = run(state, input).state;
  const phase = state.phase;
  state = run(state, "end", false).state;
  state = run(state, "configure terminal", false).state;
  const defaultPrompt = run(state, `default interface ${p.interfaceName}`, false);
  assert.equal(defaultPrompt.state.pendingConfirmation, "default-interface");
  assert.equal(defaultPrompt.state.pendingInterface, p.interfaceCanonical);
  const defaulted = run(defaultPrompt.state, "", false);
  assert.equal(defaulted.state.interfaceState.description, "");
  assert.equal(defaulted.state.phase, phase);
  const recovered = restoreIpv4ScenarioCheckpoint(defaulted.state);
  assert.equal(recovered.state.interfaceState.description, p.description);
  assert.equal(recovered.state.phase, phase);

  state = run(recovered.state, "end", false).state;
  const savePrompt = run(state, "copy running-config startup-config", false);
  state = run(savePrompt.state, "", false).state;
  assert.ok(state.startup);
  const erasePrompt = run(state, "erase startup-config", false);
  assert.equal(erasePrompt.state.pendingConfirmation, "erase-startup");
  const erased = run(erasePrompt.state, "confirm", false);
  assert.equal(erased.state.startup, null);
  const restoredStartup = restoreIpv4ScenarioCheckpoint(erased.state);
  assert.ok(restoredStartup.state.startup);
});

test("pending and checkpoint tampering is rejected", () => {
  let state = run(createIpv4Scenario(61), "enable").state;
  state = run(state, "reload", false).state;
  assert.equal(restoreIpv4ScenarioState({ ...state, pendingInterface: state.parameters.interfaceCanonical }), null);
  assert.equal(restoreIpv4ScenarioState({ ...state, recoveryCheckpoint: null }), null);
  assert.equal(restoreIpv4ScenarioState({
    ...state,
    recoveryCheckpoint: {
      ...state.recoveryCheckpoint!,
      interfaceState: { ...state.recoveryCheckpoint!.interfaceState, address: "999.1.1.1" },
    },
  }), null);
  assert.equal(restoreIpv4ScenarioState({
    ...state,
    pendingConfirmation: "default-interface",
    pendingInterface: "GigabitEthernet9/9/9",
  }), null);
});

test("save remains interactive and does not change startup state before Enter", () => {
  const { state: completed } = completeFlow(21);
  const beforeConfirmation: Ipv4ScenarioState = {
    ...completed,
    phase: "begin-save",
    acceptedActions: 24,
    subActionIndex: 0,
    mode: "privileged",
    startup: null,
    pendingConfirmation: null,
    pendingConfirmationAdvances: false,
  };
  const copy = run(beforeConfirmation, "copy running-config startup-config");
  assert.equal(copy.state.startup, null);
  assert.equal(copy.state.pendingConfirmation, "save-startup");
  assert.equal(copy.awaitingConfirmation, true);
  assert.deepEqual(copy.output, ["Destination filename [startup-config]?"]);
  const cancelled = cancelIpv4ScenarioPendingInteraction(copy.state);
  assert.equal(cancelled.valid, true);
  assert.equal(cancelled.state.pendingConfirmation, null);
  assert.equal(cancelled.state.phase, "begin-save");
  assert.equal(cancelled.state.acceptedActions, 24);
  const restartedCopy = run(cancelled.state, "copy running-config startup-config");
  const save = run(restartedCopy.state, "");
  assert.equal(save.state.phase, "complete");
  assert.ok(save.state.startup);
});

test("shell-like, evaluator-like and markup input remains inert and unreflected", () => {
  const initial = createIpv4Scenario(1);
  for (const input of [
    "$(touch /tmp/cli-rush)",
    "node -e process.exit()",
    "<script>alert(1)</script>",
    "'; DROP TABLE commands; --",
  ]) {
    const result = runIpv4ScenarioCommand(initial, input);
    assert.equal(result.accepted, false);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, "UNSUPPORTED");
    assert.deepEqual(result.state, initial);
    assert.doesNotMatch(result.output.join("\n"), /touch|script|DROP TABLE/iu);
  }
});
