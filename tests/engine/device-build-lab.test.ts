import assert from "node:assert/strict";
import test from "node:test";
import {
  completeDeviceBuildInput,
  createDeviceBuildState,
  deviceBuildLabs,
  deviceBuildPrompt,
  getDeviceBuildHint,
  getDeviceBuildStep,
  restoreDeviceBuildState,
  runDeviceBuildCommand,
} from "../../lib/device-build-lab.ts";

test("every router and switch lesson is executable in order with substantive teaching", async t => {
  for (const lab of deviceBuildLabs) {
    await t.test(lab.id, () => {
      let state = createDeviceBuildState(lab.id);
      assert.match(deviceBuildPrompt(state), />$/u);
      for (const expected of lab.steps) {
        assert.equal(getDeviceBuildStep(state)?.id, expected.id);
        const result = runDeviceBuildCommand(state, expected.command);
        assert.equal(result.accepted, true, `${lab.id}/${expected.id}: ${result.explanation}`);
        assert.ok(result.explanation.length > 40);
        assert.ok(result.useCase.length > 40);
        assert.ok(result.verification.length >= 16);
        assert.ok(result.rollback.length >= 16);
        state = result.state;
      }
      assert.equal(state.completed, true);
      assert.equal(state.stepIndex, lab.steps.length);
      assert.equal(getDeviceBuildStep(state), null);
    });
  }
});

test("saved guided builds are reconstructed and tampered state is rejected", () => {
  let state = createDeviceBuildState("router-foundation");
  for (let index = 0; index < 12; index += 1) {
    const lesson = getDeviceBuildStep(state)!;
    state = runDeviceBuildCommand(state, lesson.command).state;
  }
  assert.deepEqual(restoreDeviceBuildState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(restoreDeviceBuildState({ ...state, hostname: "ATTACKER" }), null);
  assert.equal(restoreDeviceBuildState({ ...state, stepIndex: 999 }), null);
});

test("IOS keywords are case-insensitive while configured secrets remain case-sensitive", () => {
  let switchState = createDeviceBuildState("switch-foundation");
  while (getDeviceBuildStep(switchState)?.id !== "vlan-users") {
    const lesson = getDeviceBuildStep(switchState)!;
    switchState = runDeviceBuildCommand(switchState, lesson.command).state;
  }
  assert.equal(runDeviceBuildCommand(switchState, "Vlan 10").accepted, true);
  assert.equal(runDeviceBuildCommand(switchState, "VLAN 10").accepted, true);

  let routerState = createDeviceBuildState("router-foundation");
  while (getDeviceBuildStep(routerState)?.id !== "enable-secret") {
    const lesson = getDeviceBuildStep(routerState)!;
    routerState = runDeviceBuildCommand(routerState, lesson.command).state;
  }
  assert.equal(runDeviceBuildCommand(routerState, "ENABLE SECRET Str0ngEnable!").accepted, true);
  const wrongCase = runDeviceBuildCommand(routerState, "enable secret str0ngenable!");
  assert.equal(wrongCase.accepted, false);
  assert.equal(wrongCase.errorCode, "WRONG_COMMAND");
});

test("guided hints reveal reasoning before syntax and Tab needs a real prefix", () => {
  const state = createDeviceBuildState("router-foundation");
  assert.equal(getDeviceBuildHint(state, 1).example, null);
  assert.equal(getDeviceBuildHint(state, 2).example, "enable");
  assert.equal(completeDeviceBuildInput(state, ""), "");
  assert.equal(completeDeviceBuildInput(state, "en"), "enable");
  assert.equal(completeDeviceBuildInput(state, "show"), "show");
});

test("arbitrary and oversized input stays inert and cannot advance a lab", () => {
  const state = createDeviceBuildState("switch-foundation");
  for (const input of ["$(touch owned)", "<script>alert(1)</script>", "enable; reload", "x".repeat(257)]) {
    const result = runDeviceBuildCommand(state, input);
    assert.equal(result.accepted, false);
    assert.deepEqual(result.state, state);
  }
});

test("lab interfaces use real short IOS families and the switch lab omits DHCP service", () => {
  const router = deviceBuildLabs.find(lab => lab.id === "router-foundation")!;
  const accessSwitch = deviceBuildLabs.find(lab => lab.id === "switch-foundation")!;
  assert.ok(router.steps.some(item => item.command === "interface gi0/0/1"));
  assert.ok(router.steps.some(item => item.command === "interface te0/1/1"));
  assert.ok(accessSwitch.steps.some(item => item.command === "interface fa0/0/1"));
  assert.ok(accessSwitch.steps.some(item => item.command === "interface gi0/0/1"));
  assert.ok(accessSwitch.steps.some(item => item.command === "interface fo0/1/1"));
  assert.equal(accessSwitch.steps.some(item => item.mode === "dhcp" || item.command.startsWith("ip dhcp pool")), false);
});
