import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelDeviceBuildPendingInteraction,
  completeDeviceBuildInput,
  createDeviceBuildState,
  deviceBuildCatalogue,
  deviceBuildContextName,
  deviceBuildLabs,
  deviceBuildPrompt,
  getDeviceBuildCliHelp,
  getDeviceBuildHint,
  getDeviceBuildStep,
  redactDeviceBuildInput,
  restoreDeviceBuildCheckpoint,
  restoreDeviceBuildState,
  runDeviceBuildCommand,
  type DeviceBuildLabId,
  type DeviceBuildResult,
  type DeviceBuildState,
} from "../../lib/device-build-lab.ts";
import { createLabContent } from "../../lib/lab-content.ts";

const submitExpectedResult = (state: DeviceBuildState, input?: string): DeviceBuildResult => {
  const lesson = getDeviceBuildStep(state)!;
  const result = runDeviceBuildCommand(state, input ?? lesson.command);
  if (result.awaitingConfirmation) {
    assert.equal(result.valid, true);
    assert.equal(result.accepted, false);
    assert.deepEqual(result.output, ["Destination filename [startup-config]?"]);
    const confirmed = runDeviceBuildCommand(result.state, "");
    assert.equal(confirmed.accepted, true, `${lesson.id}: ${confirmed.explanation}`);
    assert.deepEqual(confirmed.output, ["Building configuration...", "[OK]"]);
    return confirmed;
  }
  assert.equal(result.accepted, true, `${lesson.id}: ${result.explanation}`);
  assert.equal(result.valid, true);
  assert.equal(result.category, "objective-complete");
  assert.ok(result.explanation.length > 24);
  assert.ok(result.useCase.length > 24);
  assert.ok(result.verification.length > 20);
  assert.ok(result.rollback.length > 20);
  return result;
};

const submitExpected = (state: DeviceBuildState, input?: string): DeviceBuildState =>
  submitExpectedResult(state, input).state;

const completeCanonicalLab = (id: DeviceBuildLabId): {
  state: DeviceBuildState;
  evidence: Map<string, DeviceBuildResult>;
} => {
  let state = createDeviceBuildState(id, 73);
  const evidence = new Map<string, DeviceBuildResult>();
  let guard = 0;
  while (!state.completed) {
    const step = getDeviceBuildStep(state)!;
    const result = submitExpectedResult(state);
    evidence.set(step.id, result);
    state = result.state;
    guard += 1;
    assert.ok(guard <= deviceBuildLabs.find((lab) => lab.id === id)!.steps.length + 1, id);
  }
  return { state, evidence };
};

test("both rewritten foundation labs execute through the shared registry", async t => {
  for (const lab of deviceBuildLabs) {
    await t.test(lab.id, () => {
      let state = createDeviceBuildState(lab.id, 73);
      assert.match(deviceBuildPrompt(state), />$/u);
      assert.equal(deviceBuildContextName(state), "User EXEC");
      let guard = 0;
      while (!state.completed) {
        state = submitExpected(state);
        guard += 1;
        assert.ok(guard <= lab.steps.length + 1, lab.id);
      }
      assert.equal(state.stepIndex, getDeviceBuildDefinitionLength(lab.id));
      assert.equal(new Set(state.effects).size, lab.steps.length);
      assert.equal(getDeviceBuildStep(state), null);
      assert.ok(state.startupConfiguration);
      assert.equal(state.runningConfiguration.some((line) =>
        /\bsecret\s+(?!\[redacted\])/iu.test(line)
        || /(?:^|\s)key\s+(?!(?:generate|zeroize)\b|\[redacted\])/iu.test(line)), false);
      assert.equal(JSON.stringify(state).includes("Str0ngEnable!"), false);
      assert.equal(JSON.stringify(state).includes("RadKey"), false);
      assert.deepEqual(restoreDeviceBuildState(JSON.parse(JSON.stringify(state))), state);
    });
  }
});

const getDeviceBuildDefinitionLength = (id: "router-foundation" | "switch-foundation") =>
  deviceBuildLabs.find((lab) => lab.id === id)!.steps.length;

test("IOS keyword abbreviations and declared interface aliases work in every lab context", () => {
  let router = createDeviceBuildState("router-foundation", 73);
  router = runDeviceBuildCommand(router, "ena").state;
  assert.equal(router.mode, "privileged");
  router = runDeviceBuildCommand(router, "conf t").state;
  assert.equal(router.mode, "global");

  while (getDeviceBuildStep(router)?.id !== "lan-interface") router = submitExpected(router);
  const interfaceResult = runDeviceBuildCommand(router, "int gi0/0/1");
  assert.equal(interfaceResult.accepted, true, interfaceResult.explanation);
  assert.equal(interfaceResult.state.mode, "interface");

  let accessSwitch = createDeviceBuildState("switch-foundation", 73);
  while (getDeviceBuildStep(accessSwitch)?.id !== "data-range") accessSwitch = submitExpected(accessSwitch);
  const range = runDeviceBuildCommand(accessSwitch, "int range fa1/0/1 - 4");
  assert.equal(range.accepted, true, range.explanation);
  assert.equal(range.state.mode, "interface-range");
});

const abbreviatedExpectedInput = (state: DeviceBuildState): string => {
  const canonical = getDeviceBuildStep(state)!.command;
  const tokens = canonical.split(" ");
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (!/^[A-Za-z][A-Za-z-]+$/u.test(token)) continue;
    for (let length = 1; length < token.length; length += 1) {
      const candidateTokens = [...tokens];
      candidateTokens[tokenIndex] = token.slice(0, length);
      const candidate = candidateTokens.join(" ");
      const outcome = runDeviceBuildCommand(state, candidate);
      if (outcome.accepted || outcome.awaitingConfirmation) {
        tokens[tokenIndex] = candidateTokens[tokenIndex];
        break;
      }
    }
  }
  return tokens.join(" ");
};

test("both labs complete end-to-end using only parser-proven IOS keyword abbreviations", async t => {
  for (const lab of deviceBuildLabs) {
    await t.test(lab.id, () => {
      let state = createDeviceBuildState(lab.id, 73);
      let shortened = 0;
      while (!state.completed) {
        const lesson = getDeviceBuildStep(state)!;
        const input = abbreviatedExpectedInput(state);
        assert.ok(input.length <= lesson.command.length, lesson.id);
        if (input !== lesson.command) shortened += 1;
        state = submitExpected(state, input);
      }
      assert.equal(state.stepIndex, lab.steps.length);
      assert.ok(shortened >= Math.floor(lab.steps.length * 0.8), `${lab.id}: ${shortened}/${lab.steps.length}`);
    });
  }
});

test("secrets are case-sensitive and are redacted before display or persistence", () => {
  let state = createDeviceBuildState("router-foundation", 73);
  while (getDeviceBuildStep(state)?.id !== "enable-secret") state = submitExpected(state);
  const expected = getDeviceBuildStep(state)!.command;
  const lowerValue = expected.replace(/Str0ngEnable!/u, "str0ngenable!");
  const wrong = runDeviceBuildCommand(state, lowerValue);
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.valid, true);
  assert.equal(wrong.category, "valid-unrelated");
  assert.equal(redactDeviceBuildInput(state, expected), "enable secret [redacted]");

  const right = runDeviceBuildCommand(state, expected);
  assert.equal(right.accepted, true);
  assert.equal(right.displayInput, "enable secret [redacted]");
  assert.ok(right.state.runningConfiguration.includes("enable secret [redacted]"));
  assert.equal(JSON.stringify(right.state).includes("Str0ngEnable!"), false);
});

test("valid unrelated exploration executes without advancing or penalising the objective", () => {
  let state = createDeviceBuildState("router-foundation", 73);
  state = submitExpected(state);
  assert.equal(getDeviceBuildStep(state)?.id, "configure-terminal");
  const result = runDeviceBuildCommand(state, "show version");
  assert.equal(result.accepted, false);
  assert.equal(result.valid, true);
  assert.equal(result.category, "valid-unrelated");
  assert.equal(result.errorCode, "VALID_UNRELATED");
  assert.equal(result.state.stepIndex, state.stepIndex);
  assert.equal(result.state.mode, "privileged");
  assert.match(result.output.join("\n"), /stable simulated output|IOS XE/iu);
});

test("generic save, reload, erase and default-interface interactions confirm or decline without advancing", () => {
  let state = createDeviceBuildState("router-foundation", 73);
  state = submitExpected(state); // enable; current task is configure terminal
  const stepIndex = state.stepIndex;

  const savePrompt = runDeviceBuildCommand(state, "copy running-config startup-config");
  assert.equal(savePrompt.accepted, false);
  assert.equal(savePrompt.awaitingConfirmation, true);
  assert.equal(savePrompt.state.pendingConfirmation, "save-startup");
  assert.equal(savePrompt.state.device.pendingInteraction?.kind, "save");
  const wrongDestination = runDeviceBuildCommand(savePrompt.state, "wrong-name");
  assert.equal(wrongDestination.accepted, false);
  assert.equal(wrongDestination.state.pendingConfirmation, "save-startup");
  const saved = runDeviceBuildCommand(wrongDestination.state, "");
  assert.equal(saved.accepted, false);
  assert.equal(saved.valid, true);
  assert.equal(saved.state.stepIndex, stepIndex);
  assert.ok(saved.state.device.startup);
  assert.equal(saved.state.pendingConfirmation, null);
  const eventualSaveId = deviceBuildLabs.find((lab) => lab.id === "router-foundation")!.steps
    .find((step) => /^copy running-config startup-config$/iu.test(step.command))!.id;
  assert.equal(saved.state.effects.includes(eventualSaveId), false, "exploratory save must not satisfy a future timed snapshot");
  const cancelledSave = cancelDeviceBuildPendingInteraction(
    runDeviceBuildCommand(saved.state, "copy running-config startup-config").state,
  );
  assert.equal(cancelledSave.valid, true);
  assert.equal(cancelledSave.state.pendingConfirmation, null);
  assert.equal(cancelledSave.state.stepIndex, stepIndex);

  const reloadPrompt = runDeviceBuildCommand(cancelledSave.state, "reload");
  assert.equal(reloadPrompt.state.pendingConfirmation, "reload");
  assert.ok(reloadPrompt.state.device.recoveryCheckpoint);
  assert.deepEqual(restoreDeviceBuildState(JSON.parse(JSON.stringify(reloadPrompt.state))), reloadPrompt.state);
  const declined = runDeviceBuildCommand(reloadPrompt.state, "no");
  assert.equal(declined.valid, true);
  assert.equal(declined.state.pendingConfirmation, null);
  assert.equal(declined.state.stepIndex, stepIndex);

  const confirmedReload = runDeviceBuildCommand(runDeviceBuildCommand(declined.state, "reload").state, "");
  assert.equal(confirmedReload.valid, true);
  assert.equal(confirmedReload.state.mode, "user");
  assert.equal(confirmedReload.state.stepIndex, stepIndex);
  const restoredReload = restoreDeviceBuildCheckpoint(confirmedReload.state);
  assert.equal(restoredReload.valid, true);
  assert.equal(restoredReload.accepted, false);
  assert.equal(restoredReload.state.mode, "privileged");
  assert.equal(restoredReload.state.stepIndex, stepIndex);

  const erased = runDeviceBuildCommand(
    runDeviceBuildCommand(restoredReload.state, "erase startup-config").state,
    "confirm",
  );
  assert.equal(erased.state.device.startup, null);
  const restoredErase = restoreDeviceBuildCheckpoint(erased.state);
  assert.ok(restoredErase.state.device.startup);

  state = submitExpected(restoredErase.state); // configure terminal
  const globalStep = state.stepIndex;
  const defaultPrompt = runDeviceBuildCommand(state, "default interface gi0/0/1");
  assert.equal(defaultPrompt.state.pendingConfirmation, "default-interface");
  assert.equal(defaultPrompt.state.device.pendingInteraction?.kind, "default-interface");
  assert.deepEqual(restoreDeviceBuildState(JSON.parse(JSON.stringify(defaultPrompt.state))), defaultPrompt.state);
  const defaulted = runDeviceBuildCommand(defaultPrompt.state, "");
  assert.equal(defaulted.valid, true);
  assert.equal(defaulted.state.pendingConfirmation, null);
  assert.equal(defaulted.state.stepIndex, globalStep);
  const restoredDefault = restoreDeviceBuildCheckpoint(defaulted.state);
  assert.equal(restoredDefault.valid, true);
  assert.equal(restoredDefault.state.stepIndex, globalStep);
});

test("pending interaction mirrors reject tampering instead of silently clearing engine state", () => {
  let state = createDeviceBuildState("switch-foundation", 73);
  state = submitExpected(state);
  const pending = runDeviceBuildCommand(state, "reload").state;
  assert.equal(pending.pendingConfirmation, "reload");
  assert.equal(restoreDeviceBuildState({ ...pending, pendingConfirmation: null }), null);
  assert.equal(restoreDeviceBuildState({
    ...pending,
    device: { ...pending.device, pendingInteraction: { kind: "erase-startup" } },
  }), null);

  let global = createDeviceBuildState("router-foundation", 73);
  global = submitExpected(global);
  global = submitExpected(global);
  const defaultPending = runDeviceBuildCommand(global, "default interface gi0/0/1").state;
  assert.equal(restoreDeviceBuildState({
    ...defaultPending,
    device: {
      ...defaultPending.device,
      pendingInteraction: { kind: "default-interface", interfaceName: "GigabitEthernet9/9/9" },
    },
  }), null);
});

test("Lab 2 and Lab 3 verification is derived from the configured shared device state", () => {
  const router = completeCanonicalLab("router-foundation");
  const switchLab = completeCanonicalLab("switch-foundation");

  for (const result of [...router.evidence.values(), ...switchLab.evidence.values()]) {
    assert.doesNotMatch(result.output.join("\n"), /stable simulated output|authored output|placeholder/iu);
  }

  assert.equal(router.state.device.users.localadmin?.privilege, 15);
  assert.equal(router.state.device.sshVersion, 2);
  assert.equal(router.state.device.dhcpPools.USERS?.network, "192.168.10.0");
  assert.equal(router.state.device.interfaces["GigabitEthernet0/0/1"]?.ipv4, "192.168.10.1");
  assert.ok(router.state.device.staticRoutes.some((route) => route.nextHop === "192.0.2.2"));
  assert.match(router.evidence.get("verify-interfaces")!.output.join("\n"), /GigabitEthernet0\/0\/0.*192\.0\.2\.1.*up.*up/iu);
  assert.match(router.evidence.get("verify-dhcp-binding")!.output.join("\n"), /192\.168\.10\.21/iu);
  assert.match(router.evidence.get("verify-aaa-ready")!.output.join("\n"), /State: UP/iu);
  assert.match(router.evidence.get("verify-central-login")!.output.join("\n"), /RADIUS server accepted central user centraladmin/iu);
  assert.match(router.evidence.get("verify-aaa")!.output.join("\n"), /State: DEAD/iu);
  assert.match(router.evidence.get("verify-fallback")!.output.join("\n"), /Local fallback accepted localadmin/iu);
  assert.equal(router.state.device.radiusServers.RAD1.administrativelyDisabled, true);
  assert.match(router.evidence.get("test-remote")!.output.join("\n"), /Success rate is 100 percent/iu);
  assert.equal(router.evidence.get("verify-startup")!.output.join("\n"), router.state.device.startup);

  assert.equal(switchLab.state.device.vlans[10]?.name, "DATA");
  assert.equal(switchLab.state.device.vlans[20]?.name, "VOICE");
  assert.equal(switchLab.state.device.vlans[99]?.name, "MANAGEMENT");
  assert.equal(switchLab.state.device.interfaces["FastEthernet1/0/1"]?.portSecurityMaximum, 2);
  assert.equal(switchLab.state.device.interfaces["FastEthernet1/0/9"]?.adminUp, false);
  assert.equal(switchLab.state.device.interfaces["TenGigabitEthernet1/1/1"]?.channelGroup, 1);
  assert.deepEqual(switchLab.state.device.interfaces["Port-channel1"]?.trunkAllowedVlans, [10, 20, 99]);
  assert.match(switchLab.evidence.get("verify-interface-status")!.output.join("\n"), /FastEthernet1\/0\/9\s+disabled/iu);
  assert.match(switchLab.evidence.get("verify-trunk")!.output.join("\n"), /Port-channel1.*10,20,99/iu);
  assert.match(switchLab.evidence.get("verify-etherchannel")!.output.join("\n"), /TenGigabitEthernet1\/1\/1[\s\S]*TenGigabitEthernet1\/1\/2/iu);
  assert.equal(switchLab.evidence.get("verify-switch-startup")!.output.join("\n"), switchLab.state.device.startup);
});

test("broken DHCP, interface, management and RADIUS dependencies produce failure evidence and do not complete verification", () => {
  let router = createDeviceBuildState("router-foundation", 73);
  while (getDeviceBuildStep(router)?.id !== "verify-dhcp-binding") router = submitExpected(router);
  const brokenDhcp = JSON.parse(JSON.stringify(router)) as DeviceBuildState;
  brokenDhcp.device.dhcpPools.USERS.network = null;
  const binding = runDeviceBuildCommand(brokenDhcp, getDeviceBuildStep(brokenDhcp)!.command);
  assert.equal(binding.accepted, false);
  assert.match(binding.output.join("\n"), /No DHCP bindings/iu);

  let switchState = createDeviceBuildState("switch-foundation", 73);
  while (getDeviceBuildStep(switchState)?.id !== "verify-interface-status") switchState = submitExpected(switchState);
  const brokenAccess = JSON.parse(JSON.stringify(switchState)) as DeviceBuildState;
  brokenAccess.device.interfaces["FastEthernet1/0/1"].adminUp = false;
  const status = runDeviceBuildCommand(brokenAccess, getDeviceBuildStep(brokenAccess)!.command);
  assert.equal(status.accepted, false);
  assert.match(status.output.join("\n"), /FastEthernet1\/0\/1\s+disabled/iu);

  while (getDeviceBuildStep(switchState)?.id !== "test-management-gateway") switchState = submitExpected(switchState);
  const brokenUplink = JSON.parse(JSON.stringify(switchState)) as DeviceBuildState;
  brokenUplink.device.interfaces["Port-channel1"].adminUp = false;
  const ping = runDeviceBuildCommand(brokenUplink, getDeviceBuildStep(brokenUplink)!.command);
  assert.equal(ping.accepted, false);
  assert.match(ping.output.join("\n"), /Success rate is 0 percent/iu);

  let radius = createDeviceBuildState("router-foundation", 73);
  while (getDeviceBuildStep(radius)?.id !== "verify-fallback") radius = submitExpected(radius);
  const radiusServer = radius.device.radiusServers.RAD1;
  if (Object.hasOwn(radiusServer, "administrativelyDisabled")) {
    radiusServer.administrativelyDisabled = false;
    const fallback = runDeviceBuildCommand(radius, getDeviceBuildStep(radius)!.command);
    assert.equal(fallback.accepted, false);
    assert.match(fallback.output.join("\n"), /Authentication failed/iu);
    assert.doesNotMatch(fallback.output.join("\n"), /local fallback accepted localadmin/iu);
  }
});

test("future configuration completed early is skipped without mastery credit", () => {
  let state = createDeviceBuildState("router-foundation", 73);
  state = submitExpected(state);
  state = submitExpected(state);
  assert.equal(state.mode, "global");
  const future = runDeviceBuildCommand(state, "service password-encryption");
  assert.equal(future.category, "valid-unrelated");
  assert.ok(future.state.effects.includes("password-encryption"));
  assert.equal(future.state.device.passwordEncryption, true);
  state = future.state;
  state = submitExpected(state); // hostname
  state = submitExpected(state); // enable secret
  state = submitExpected(state); // local admin; password-encryption is now skipped
  assert.ok(state.skippedSatisfiedStepIds.includes("password-encryption"));
  assert.equal(getDeviceBuildStep(state)?.id, "aaa-new-model");
});

test("progressive help separates reasoning, syntax shape and exact reveal", () => {
  const state = createDeviceBuildState("router-foundation", 73);
  const first = getDeviceBuildHint(state, 1);
  assert.equal(first.example, null);
  assert.equal(first.revealed, false);
  assert.doesNotMatch(first.explanation, /^enable$/iu);
  const second = getDeviceBuildHint(state, 2);
  assert.equal(second.example, null);
  assert.equal(second.revealed, false);
  assert.match(second.explanation, /begins with en/iu);
  const reveal = getDeviceBuildHint(state, 3);
  assert.equal(reveal.example, "enable");
  assert.equal(reveal.revealed, true);
});

test("Tab and contextual help use the full profile-filtered command tree", () => {
  let state = createDeviceBuildState("switch-foundation", 73);
  const completion = completeDeviceBuildInput(state, "en");
  assert.equal(completion.input, "enable");
  assert.equal(completion.changed, true);
  const help = getDeviceBuildCliHelp(state, "");
  assert.ok(help.options.some((option) => option.value === "enable"));
  assert.ok(help.options.some((option) => option.value === "ping"));
  assert.equal(help.options.some((option) => option.value === "configure"), false);

  while (getDeviceBuildStep(state)?.id !== "data-range") state = submitExpected(state);
  const globalHelp = getDeviceBuildCliHelp(state, "interface ");
  assert.ok(globalHelp.options.some((option) => /INTERFACE|range/iu.test(option.value)));
});

test("version 3 shared state restores, legacy progress migrates and tampering is rejected", () => {
  let state = createDeviceBuildState("router-foundation", 73);
  for (let index = 0; index < 8; index += 1) state = submitExpected(state);
  assert.deepEqual(restoreDeviceBuildState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(restoreDeviceBuildState({ ...state, effects: ["not-a-step"] }), null);
  const unredactedCredential = ["enable", "secret", "exposed-value"].join(" ");
  assert.equal(restoreDeviceBuildState({ ...state, runningConfiguration: [unredactedCredential] }), null);
  assert.equal(restoreDeviceBuildState({
    ...state,
    device: { ...state.device, appliedConfiguration: [unredactedCredential] },
  }), null);
  assert.equal(restoreDeviceBuildState({
    ...state,
    device: {
      ...state.device,
      interfaces: { ...state.device.interfaces, [state.device.selectedInterface]: "not-device-state" },
    },
  }), null);
  for (const linePasswordConfigured of [
    null,
    [],
    { "vty 0 4": "configured" },
    { "vty 4 0": true },
    { "not-a-line": true },
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`vty ${index}`, true])),
  ]) {
    assert.equal(restoreDeviceBuildState({
      ...state,
      device: { ...state.device, linePasswordConfigured },
    }), null);
  }

  const legacyDevice = { ...state.device } as Partial<DeviceBuildState["device"]> & Record<string, unknown>;
  delete legacyDevice.linePasswordConfigured;
  const legacyLinePassword = [["pass", "word"].join(""), "<test-value>"].join(" ");
  legacyDevice.lineSettings = {
    ...state.device.lineSettings,
    "vty 0 4": [legacyLinePassword],
  };
  const restoredLegacyDevice = restoreDeviceBuildState({ ...state, device: legacyDevice });
  assert.ok(restoredLegacyDevice);
  assert.equal(restoredLegacyDevice.device.linePasswordConfigured["vty 0 4"], true);
  assert.deepEqual(restoredLegacyDevice.device.lineSettings["vty 0 4"], []);
  assert.equal(JSON.stringify(restoredLegacyDevice).includes("<test-value>"), false);

  const legacyVersionTwo = { ...state } as Partial<DeviceBuildState> & Record<string, unknown>;
  delete legacyVersionTwo.device;
  const migratedVersionTwo = restoreDeviceBuildState({ ...legacyVersionTwo, version: 2 });
  assert.ok(migratedVersionTwo);
  assert.equal(migratedVersionTwo.version, 3);
  assert.equal(migratedVersionTwo.stepIndex, state.stepIndex);
  assert.equal(migratedVersionTwo.device.hostname, state.device.hostname);

  const migrated = restoreDeviceBuildState({
    version: 1,
    labId: "router-foundation",
    stepIndex: 5,
    mode: "global",
    hostname: "R1",
    completed: false,
  });
  assert.ok(migrated);
  assert.equal(migrated.version, 3);
  assert.ok(migrated.stepIndex > 0);
});

test("shell, evaluator and markup-like text remains inert", () => {
  const initial = createDeviceBuildState("switch-foundation", 73);
  for (const input of ["$(touch owned)", "node -e process.exit()", "<script>alert(1)</script>", "'; DROP TABLE commands; --"]) {
    const result = runDeviceBuildCommand(initial, input);
    assert.equal(result.accepted, false);
    assert.equal(result.valid, false);
    assert.deepEqual(result.state, initial);
    assert.doesNotMatch(result.output.join("\n"), /touch|script|DROP TABLE/u);
  }
});

test("the generated catalogue preserves every lab task and all task IDs are unique", () => {
  for (const lab of deviceBuildLabs) {
    const catalogue = deviceBuildCatalogue(lab.id, 73);
    const seeded = createLabContent(lab.id, 73);
    assert.equal(catalogue.length, seeded.steps.length);
    assert.equal(new Set(catalogue.map((item) => item.id)).size, catalogue.length);
    assert.deepEqual(catalogue.map((item) => item.canonical), seeded.steps.map((item) => item.command));
  }
});
