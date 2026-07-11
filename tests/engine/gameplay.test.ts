import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedAttemptPolicy,
  failureFeedback,
  mayRevealAnswers,
  shouldRecordTimedOutObjective,
} from "../../lib/gameplay.ts";

test("accepted attempts distinguish first recall from retry credit", () => {
  assert.deepEqual(acceptedAttemptPolicy(1, 4), {
    attempt: 1,
    outcome: "firstTry",
    firstTry: true,
    combo: 5,
  });
  assert.deepEqual(acceptedAttemptPolicy(2, 4), {
    attempt: 2,
    outcome: "retry",
    firstTry: false,
    combo: 0,
  });
  assert.deepEqual(acceptedAttemptPolicy(3, 4), {
    attempt: 3,
    outcome: "retry",
    firstTry: false,
    combo: 0,
  });
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
