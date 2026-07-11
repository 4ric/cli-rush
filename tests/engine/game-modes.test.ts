import assert from "node:assert/strict";
import test from "node:test";
import {
  correctAnswerEffect,
  gameModeById,
  gameModes,
  initialTimeMs,
  nextConsecutiveWrong,
  wrongAnswerEffect,
  type GameModeId,
} from "../../lib/game-modes.ts";

const modeIds: GameModeId[] = ["easy", "normal", "hard", "hardcore"];

test("game modes expose concise player-facing rules", () => {
  const expected = [
    ["easy", "Easy", null],
    ["normal", "Normal", 60_000],
    ["hard", "Hard", 60_000],
    ["hardcore", "Hardcore", 60_000],
  ] as const;

  assert.deepEqual(Object.keys(gameModes), modeIds);
  for (const [id, label, startingTime] of expected) {
    const rules = gameModeById(id);
    assert.equal(rules.id, id);
    assert.equal(rules.label, label);
    assert.equal(rules.initialTimeMs, startingTime);
    assert.equal(initialTimeMs(id), startingTime);
    assert.match(rules.description, /\S/);
  }
});

test("consecutive wrong answers advance through three capped tiers", () => {
  const cases = [
    [-5, 1],
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 3],
    [99, 3],
  ] as const;

  for (const [previous, expected] of cases) {
    assert.equal(nextConsecutiveWrong(previous), expected);
  }
});

test("wrong-answer penalties are exhaustive and cap at tier three", () => {
  const penalties: Record<GameModeId, readonly [number, number, number]> = {
    easy: [0, 0, 0],
    normal: [-1_000, -3_000, -5_000],
    hard: [-5_000, -10_000, -15_000],
    hardcore: [0, 0, 0],
  };

  for (const mode of modeIds) {
    for (const [previousWrong, expectedWrong] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [8, 3],
    ] as const) {
      const effect = wrongAnswerEffect(mode, previousWrong);
      assert.equal(effect.timeDeltaMs, penalties[mode][expectedWrong - 1], `${mode} tier ${expectedWrong}`);
      assert.equal(effect.terminalFailure, mode === "hardcore", mode);
      assert.equal(effect.nextConsecutiveWrong, expectedWrong, mode);
    }
  }
});

test("correct-answer bonuses cover every mode and the normal combination threshold", () => {
  const bonuses: Record<GameModeId, readonly [number, number, number, number]> = {
    easy: [0, 0, 0, 0],
    normal: [3_000, 3_000, 5_000, 5_000],
    hard: [3_000, 3_000, 3_000, 3_000],
    hardcore: [2_000, 2_000, 2_000, 2_000],
  };
  const combos = [0, 2, 3, 20] as const;

  for (const mode of modeIds) {
    for (const [index, combo] of combos.entries()) {
      const effect = correctAnswerEffect(mode, combo);
      assert.equal(effect.timeDeltaMs, bonuses[mode][index], `${mode} combination ${combo}`);
      assert.equal(effect.terminalFailure, false, mode);
      assert.equal(effect.nextConsecutiveWrong, 0, `${mode} resets the error escalation`);
    }
  }
});
