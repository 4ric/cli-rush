import assert from "node:assert/strict";
import test from "node:test";
import {
  commands,
  executeCliCommand,
  handleCliControl,
  initialDevice,
  type DeviceState,
} from "../../lib/engine.ts";
import { goodToKnowDistinctions, goodToKnowLessons } from "../../lib/good-to-know.ts";

const run = (state: DeviceState, input: string): DeviceState => {
  const result = executeCliCommand(state, input, commands);
  assert.equal(result.accepted, true, `${input}: ${result.output.join(" ")}`);
  return result.state;
};

const fixture = (): DeviceState => {
  let state = initialDevice("router-ios-xe");
  for (const input of [
    "enable",
    "configure terminal",
    "interface GigabitEthernet0/0/1",
    "description BASELINE UPLINK",
    "end",
    "copy running-config startup-config",
    "",
  ]) state = run(state, input);
  return state;
};

test("Good to know covers every requested save, undo and recovery distinction", () => {
  const ids = new Set(goodToKnowLessons.map((lesson) => lesson.id));
  for (const required of [
    "inspect-running",
    "inspect-startup",
    "compare-running-startup",
    "make-unsaved-description",
    "undo-description",
    "save-verified-change",
    "save-alternative",
    "exit-one-context",
    "end-to-exec",
    "cancel-with-control-c",
    "leave-with-control-z",
    "merge-startup-running",
    "restore-saved-snapshot",
    "default-interface",
    "understand-disruptive-reset",
  ]) assert.ok(ids.has(required), required);

  assert.equal(new Set(goodToKnowDistinctions.map((item) => item.id)).size, goodToKnowDistinctions.length);
  for (const lesson of goodToKnowLessons) {
    assert.ok(lesson.task.trim().split(/\s+/u).length <= 20, lesson.id);
    assert.ok(lesson.why.length >= 60, lesson.id);
    assert.ok(lesson.verification.length >= 40, lesson.id);
    assert.ok(lesson.recovery.length >= 30, lesson.id);
  }
  assert.match(goodToKnowDistinctions.find((item) => item.id === "merge-replace")!.detail, /merge|replace/iu);
  assert.match(goodToKnowDistinctions.find((item) => item.id === "reload")!.detail, /interrupt|disrupt/iu);
});

test("every hands-on lesson replays through the shared parser and deterministic state", () => {
  let state = fixture();
  for (const lesson of goodToKnowLessons) {
    for (const input of lesson.fixture ?? []) state = run(state, input);
    assert.equal(state.context, lesson.mode, `${lesson.id} fixture prompt`);

    if (lesson.control) {
      const beforeHostname = state.hostname;
      const result = handleCliControl(state, lesson.control, lesson.initialDraft ?? "", [], 0);
      state = result.state;
      assert.equal(state.context, "privileged", lesson.id);
      if (lesson.control === "Ctrl+C") assert.equal(state.hostname, beforeHostname, "Ctrl+C must not execute the unfinished draft");
      if (lesson.control === "Ctrl+Z") assert.equal(state.hostname, "Z-DRAFT-RAN", "Ctrl+Z executes the valid declared-profile draft");
      continue;
    }

    state = run(state, lesson.command);
    if (lesson.confirmation === "accept-default") state = run(state, "");
    if (lesson.confirmation === "confirm") state = run(state, "confirm");
    if (lesson.confirmation === "decline") {
      const result = executeCliCommand(state, "no", commands);
      assert.equal(result.accepted, false, "declining a disruptive operation is intentionally not an accepted mutation");
      assert.match(result.output.join(" "), /declined/iu);
      state = result.state;
    }
    assert.equal(state.pendingInteraction, null, `${lesson.id} must not leave a hidden confirmation pending`);

    if (lesson.id === "merge-startup-running") {
      assert.equal(state.interfaces["GigabitEthernet0/0/0"]?.description, "MERGE SURVIVES", "startup-to-running copy is a merge, not rollback");
    }
    if (lesson.id === "restore-saved-snapshot") {
      assert.ok(state.recoveryCheckpoint, "configure replace guarantees a local recovery checkpoint");
      assert.equal(state.interfaces["GigabitEthernet0/0/1"]?.description, "VERIFIED TRAINING LINK");
      assert.equal(state.interfaces["GigabitEthernet0/0/0"]?.description ?? "", "", "replacement removes unrelated unsaved state");
    }
    if (lesson.id === "default-interface") {
      assert.equal(state.interfaces["GigabitEthernet0/0/1"]?.description, "", "confirmed default resets the interface description");
      assert.ok(state.recoveryCheckpoint, "broad default keeps a recovery checkpoint");
    }
  }
});
