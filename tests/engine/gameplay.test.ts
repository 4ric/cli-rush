import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedAttemptPolicy,
  classifyRoundRecord,
  failureFeedback,
  mayRevealAnswers,
  shouldRecordTimedOutObjective,
} from "../../lib/gameplay.ts";

test("a clean first recall can advance mastery, records and combination", () => {
  const policy = acceptedAttemptPolicy(1, 4);
  assert.equal(policy.classification, "clean-recall");
  assert.equal(policy.cleanRecall, true);
  assert.equal(policy.masteryEligible, true);
  assert.equal(policy.cleanRecordEligible, true);
  assert.equal(policy.roundRecordEligible, true);
  assert.equal(policy.reviewOutcome, "firstTry");
  assert.equal(policy.combo, 5);
});

test("a recovered answer earns operational credit without clean mastery", () => {
  const policy = acceptedAttemptPolicy(2, 4);
  assert.equal(policy.classification, "recovered-recall");
  assert.equal(policy.operationalRewardEligible, true);
  assert.equal(policy.masteryEligible, false);
  assert.equal(policy.cleanRecordEligible, false);
  assert.equal(policy.roundRecordEligible, true);
  assert.equal(policy.reviewOutcome, "retry");
  assert.equal(policy.combo, 0);
});

test("CLI assistance preserves operational reward but not clean credit", () => {
  const policy = acceptedAttemptPolicy(1, 4, true);
  assert.equal(policy.classification, "cli-assisted");
  assert.equal(policy.operationalSuccess, true);
  assert.equal(policy.operationalRewardEligible, true);
  assert.equal(policy.masteryEligible, false);
  assert.equal(policy.cleanRecordEligible, false);
  assert.equal(policy.roundRecordEligible, false);
  assert.equal(policy.reviewOutcome, null);
  assert.equal(policy.combo, 0);
});

test("a run with assistance is classified separately from clean personal bests", () => {
  assert.equal(classifyRoundRecord(0, 0), null);
  assert.equal(classifyRoundRecord(5, 0), "clean");
  assert.equal(classifyRoundRecord(5, 1), "field");
});

test("failure feedback explains the error without adding a canonical answer", () => {
  const canonical = "show ip interface brief";
  const message = failureFeedback("The command is in the wrong mode.");
  assert.match(message, /wrong mode/i);
  assert.match(message, /time bank reaches zero/i);
  assert.doesNotMatch(message, /round ends/i);
  assert.doesNotMatch(message, new RegExp(canonical, "i"));
});

test("answers can be revealed only after the timer reaches zero", () => {
  assert.equal(mayRevealAnswers(false), false);
  assert.equal(mayRevealAnswers(true), true);
});

test("only an unanswered objective is recorded when the timer expires", () => {
  assert.equal(shouldRecordTimedOutObjective(false, false), false);
  assert.equal(shouldRecordTimedOutObjective(false, true), false);
  assert.equal(shouldRecordTimedOutObjective(true, true), false);
  assert.equal(shouldRecordTimedOutObjective(true, false), true);
});
