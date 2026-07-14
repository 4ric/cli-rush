import assert from "node:assert/strict";
import test from "node:test";
import { commands } from "../../lib/engine.ts";
import {
  buildLearningTasks,
  classifyLearningOutcome,
  learningTaskFor,
} from "../../lib/learning-tasks.ts";

test("every built-in command is represented by one complete shared learning task", () => {
  const tasks = buildLearningTasks(commands);
  assert.equal(tasks.length, commands.length);
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
  assert.equal(new Set(tasks.map((task) => task.commandId)).size, commands.length);

  for (const task of tasks) {
    assert.ok(task.task.trim().split(/\s+/u).length <= 20, `${task.id}: task is too long`);
    for (const field of [
      task.whyThisMatters,
      task.hint1,
      task.hint2,
      task.expectedEffect,
      task.correctExplanation,
      task.verification,
      task.outputInterpretation,
      task.commonFailure,
      task.recovery,
      task.conceptId,
    ]) {
      assert.match(field, /\S/u, task.id);
    }
    assert.equal(task.requiredContext, task.startingState.mode, task.id);
    assert.equal(task.canonicalCommand, commands.find((command) => command.id === task.commandId)?.canonical);
    assert.doesNotMatch(task.hint1.toLocaleLowerCase("en-GB"), new RegExp(
      task.canonicalCommand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").toLocaleLowerCase("en-GB"),
      "u",
    ), task.id);
    assert.equal(
      task.task.toLocaleLowerCase("en-GB").includes(task.canonicalCommand.toLocaleLowerCase("en-GB")),
      false,
      `${task.id}: task contains the complete pasteable answer`,
    );
    assert.doesNotMatch(task.hint2, /Str0ngEnable!/u, `${task.id}: Hint 2 exposed a seeded secret`);
    assert.doesNotMatch(
      `${task.task} ${task.hint1} ${task.hint2}`,
      /identify the destination CLI context|choose the command family|current seeded values|worked command with|your valid input does not complete|start from the .* prompt and make one context change|make one scoped change, then predict|look for read-only evidence that answers/iu,
      `${task.id}: placeholder coaching remains`,
    );
    assert.ok(task.correctExplanation.length >= 30, `${task.id}: reveal lacks a useful purpose explanation`);
    assert.ok(task.expectedEffect.length >= 20, `${task.id}: reveal lacks a state or prompt effect`);
    if (task.kind === "inspection") {
      assert.ok(task.outputInterpretation.length >= 30, `${task.id}: inspection lacks output interpretation`);
    }
  }

  assert.equal(new Set(tasks.map((task) => task.hint1)).size, tasks.length, "Hint 1 must be task-specific");
  const contextual = tasks.filter((task) => task.requiredContext !== "user");
  assert.ok(contextual.length > 150);
  for (const task of contextual) {
    assert.ok(task.prerequisites.length > 0, `${task.id}: contextual task has no reachable-context prerequisite`);
    assert.equal(task.prerequisites.includes(task.commandId), false, `${task.id}: task depends on itself`);
  }
});

test("high-risk operational families include a cause-and-effect reason", () => {
  const important = commands.filter((command) =>
    /(?:route|ping|shutdown|vlan|save)/iu.test(`${command.id} ${command.canonical} ${command.topic}`));
  assert.ok(important.length > 20);
  for (const command of important) {
    const task = learningTaskFor(command);
    assert.ok(task.whyThisMatters.length >= 35, command.id);
    assert.doesNotMatch(task.whyThisMatters, /Runs? the command|Use this command to complete/iu, command.id);
  }
});

test("priority examples teach cause and effect rather than only exposing syntax", () => {
  const byId = new Map(commands.map((command) => [command.id, learningTaskFor(command)]));
  const enable = byId.get("nav.enable")!;
  assert.match(enable.task, /User EXEC.*Privileged EXEC/u);
  assert.match(enable.expectedEffect, /R1>.*R1#/u);
  assert.doesNotMatch(enable.hint1, /\benable\b/iu);
  assert.match(enable.hint2, /begins with en/iu);

  const configure = byId.get("nav.configure")!;
  assert.match(configure.expectedEffect, /not.*saved automatically/iu);
  assert.doesNotMatch(configure.hint1, /configure terminal/iu);

  const passwordEncryption = byId.get("config.password-encryption")!;
  assert.match(passwordEncryption.correctExplanation, /not secure encryption/iu);

  const inspect = byId.get("show.ip-interface-brief")!;
  assert.match(inspect.outputInterpretation, /up\/down/iu);

  const noShutdown = byId.get("interface.no-shutdown")!;
  assert.match(noShutdown.correctExplanation, /does not|still determine/iu);
});

test("assistance outcomes preserve guided discovery but protect clean mastery", () => {
  const none = { hintUsed: false, tabUsed: false, helpUsed: false, answerRevealed: false };
  assert.equal(classifyLearningOutcome(true, none), "independent");
  assert.equal(classifyLearningOutcome(true, { ...none, helpUsed: true }), "guided-discovery");
  assert.equal(classifyLearningOutcome(true, { ...none, tabUsed: true }), "assisted");
  assert.equal(classifyLearningOutcome(true, { ...none, hintUsed: true, helpUsed: true }), "assisted");
  assert.equal(classifyLearningOutcome(true, { ...none, answerRevealed: true }), "revealed");
  assert.equal(classifyLearningOutcome(false, none), "incorrect");
  assert.equal(classifyLearningOutcome(false, none, true), "skipped");
});
