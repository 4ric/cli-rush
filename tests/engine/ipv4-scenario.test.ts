import assert from "node:assert/strict";
import test from "node:test";
import {
  createIpv4Scenario,
  getIpv4ScenarioChoices,
  getIpv4ScenarioObjective,
  ipv4ScenarioPrompt,
  runIpv4ScenarioCommand,
  submitIpv4ScenarioInterpretation,
  type Ipv4ScenarioChoiceId,
  type Ipv4ScenarioState,
} from "../../lib/ipv4-scenario.ts";

const command = (state: Ipv4ScenarioState, input: string) => {
  const result = runIpv4ScenarioCommand(state, input);
  assert.equal(result.accepted, true, `${input}: ${result.explanation}`);
  assert.equal(result.errorCode, undefined);
  assert.ok(result.explanation.length > 20);
  assert.ok(result.useCase.length > 20);
  assert.ok(result.verification.length > 20);
  assert.ok(result.rollback.length > 20);
  assert.ok(result.nextObjective.length > 20);
  return result;
};

const interpret = (state: Ipv4ScenarioState, choice: Ipv4ScenarioChoiceId) => {
  const result = submitIpv4ScenarioInterpretation(state, choice);
  assert.equal(result.accepted, true, result.explanation);
  return result;
};

const reachConfiguredInterface = (seed = 1) => {
  let state = createIpv4Scenario(seed);
  const p = state.parameters;
  state = command(state, "enable").state;
  state = command(state, "configure terminal").state;
  state = command(state, `interface ${p.interfaceName}`).state;
  state = command(state, `ip address ${p.localAddress} ${p.subnetMask}`).state;
  state = command(state, "no shutdown").state;
  state = command(state, "end").state;
  return state;
};

test("scenario parameters and seeded fault are deterministic and start at R1>", () => {
  const first = createIpv4Scenario(73);
  const repeat = createIpv4Scenario(73);
  assert.deepEqual(first, repeat);
  assert.equal(ipv4ScenarioPrompt(first), "R1>");
  assert.equal(first.mode, "user");
  assert.equal(first.phase, "gain-privilege");
  assert.match(getIpv4ScenarioObjective(first), /privileged EXEC/i);
  assert.notDeepEqual(createIpv4Scenario(74).parameters, first.parameters);
});

test("full lab configures, diagnoses, verifies, saves and rolls back", () => {
  let state = reachConfiguredInterface(73);
  const p = state.parameters;
  assert.equal(ipv4ScenarioPrompt(state), "R1#");
  assert.deepEqual(state.interfaceState, { address: p.localAddress, mask: p.subnetMask, adminUp: true });

  let result = command(state, "show ip interface brief");
  assert.match(result.output.join("\n"), new RegExp(p.localAddress.replaceAll(".", "\\.")));
  assert.match(result.output.join("\n"), /up\s+up/);
  state = result.state;

  assert.equal(getIpv4ScenarioChoices(state).length, 4);
  state = interpret(state, "interface-operational").state;

  result = command(state, `ping ${p.remoteTarget}`);
  assert.match(result.output.join("\n"), /0 percent \(0\/5\)/);
  state = result.state;

  result = command(state, "show ip route");
  assert.match(result.output.join("\n"), new RegExp(`${p.networkAddress.replaceAll(".", "\\.")}\/24`));
  state = result.state;
  state = interpret(state, state.fault).state;

  state = command(state, "configure terminal").state;
  if (state.phase === "remove-faulty-route") {
    state = command(state, `no ip route 0.0.0.0 0.0.0.0 ${p.wrongGateway}`).state;
  }
  state = command(state, `ip route 0.0.0.0 0.0.0.0 ${p.gateway}`).state;
  state = command(state, "end").state;

  result = command(state, `ping ${p.remoteTarget}`);
  assert.match(result.output.join("\n"), /100 percent \(5\/5\)/);
  state = result.state;

  result = command(state, "copy running-config startup-config");
  assert.deepEqual(result.output, ["Destination filename [startup-config]?", "Building configuration...", "[OK]"]);
  assert.equal(result.state.startup?.defaultRoute, p.gateway);
  assert.equal(result.state.startup?.interfaceState.address, p.localAddress);
  state = result.state;

  state = command(state, "configure terminal").state;
  state = command(state, `no ip route 0.0.0.0 0.0.0.0 ${p.gateway}`).state;
  state = command(state, `interface ${p.interfaceName}`).state;
  state = command(state, "shutdown").state;
  state = command(state, "no ip address").state;
  state = command(state, "end").state;

  result = command(state, "show ip interface brief");
  assert.match(result.output.join("\n"), /unassigned/);
  assert.match(result.output.join("\n"), /administratively down\s+down/);
  state = result.state;
  state = interpret(state, "rollback-complete").state;

  result = command(state, "show ip route");
  assert.match(result.output.join("\n"), /Gateway of last resort is not set/);
  assert.doesNotMatch(result.output.join("\n"), /S\*\s+0\.0\.0\.0\/0/);
  state = result.state;

  result = command(state, "copy running-config startup-config");
  assert.equal(result.state.phase, "complete");
  assert.equal(result.state.startup?.defaultRoute, null);
  assert.deepEqual(result.state.startup?.interfaceState, { address: null, mask: null, adminUp: false });
  assert.match(result.nextObjective, /Lab complete/i);
});

test("manual mode navigation is required and rejected commands do not mutate state", () => {
  const initial = createIpv4Scenario(2);
  const wrongMode = runIpv4ScenarioCommand(initial, "configure terminal");
  assert.equal(wrongMode.accepted, false);
  assert.equal(wrongMode.errorCode, "WRONG_MODE");
  assert.deepEqual(wrongMode.state, initial);

  const enabled = command(initial, "enable").state;
  const wrongStep = runIpv4ScenarioCommand(enabled, "show ip interface brief");
  assert.equal(wrongStep.accepted, false);
  assert.equal(wrongStep.errorCode, "WRONG_STEP");
  assert.deepEqual(wrongStep.state, enabled);
});

test("unique IOS keyword abbreviations work while scenario values remain exact", () => {
  let state = createIpv4Scenario(31);
  const p = state.parameters;
  state = command(state, "en").state;
  state = command(state, "conf t").state;
  state = command(state, `int ${p.interfaceName}`).state;
  const wrongValue = runIpv4ScenarioCommand(state, `ip add 192.0.2.99 ${p.subnetMask}`);
  assert.equal(wrongValue.accepted, false);
  state = command(state, `ip add ${p.localAddress} ${p.subnetMask}`).state;
  state = command(state, "no sh").state;
  state = command(state, "end").state;
  const show = command(state, "sh ip int br");
  assert.match(show.output.join("\n"), /up\s+up/);
});

test("syntax, addresses, masks and task values are rejected specifically", () => {
  let state = createIpv4Scenario(4);
  state = command(state, "enable").state;
  state = command(state, "configure terminal").state;
  state = command(state, `interface ${state.parameters.interfaceName}`).state;

  for (const [input, errorCode] of [
    ["ip address 192.0.2.1", "INVALID_SYNTAX"],
    ["ip address 300.0.2.1 255.255.255.0", "INVALID_IPV4"],
    ["ip address 192.0.2.1 0.0.0.255", "INVALID_MASK"],
    ["ip address 10.0.0.1 255.255.255.0", "WRONG_VALUE"],
  ] as const) {
    const result = runIpv4ScenarioCommand(state, input);
    assert.equal(result.accepted, false);
    assert.equal(result.errorCode, errorCode);
    assert.deepEqual(result.state, state);
  }
});

test("interface and routing output reflect state changes", () => {
  let state = reachConfiguredInterface(10);
  const p = state.parameters;
  let result = command(state, "show ip interface brief");
  assert.match(result.output[1], /up\s+up$/);
  state = interpret(result.state, "interface-operational").state;
  state = command(state, `ping ${p.remoteTarget}`).state;
  result = command(state, "show ip route");
  assert.match(result.output.join("\n"), /C\s+/);
  assert.match(result.output.join("\n"), /Gateway of last resort/);
});

test("incorrect evidence interpretation is not accepted", () => {
  let state = reachConfiguredInterface(15);
  state = command(state, "show ip interface brief").state;
  const result = submitIpv4ScenarioInterpretation(state, "interface-physical-fault");
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, "WRONG_INTERPRETATION");
  assert.deepEqual(result.state, state);
});

test("command entry is blocked while an interpretation is required", () => {
  let state = reachConfiguredInterface(21);
  state = command(state, "show ip interface brief").state;
  const result = runIpv4ScenarioCommand(state, "ping 192.0.2.10");
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, "INTERPRETATION_REQUIRED");
  assert.deepEqual(result.state, state);
});

test("shell-like and evaluator-like text remains inert", () => {
  const initial = createIpv4Scenario(1);
  for (const input of [
    "$(touch /tmp/cli-rush)",
    "node -e process.exit()",
    "<script>alert(1)</script>",
    "'; DROP TABLE commands; --",
  ]) {
    const result = runIpv4ScenarioCommand(initial, input);
    assert.equal(result.accepted, false);
    assert.equal(result.errorCode, "UNSUPPORTED");
    assert.deepEqual(result.state, initial);
    assert.doesNotMatch(result.output.join("\n"), /touch|script|DROP TABLE/);
  }
});
