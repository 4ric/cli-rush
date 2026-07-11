import assert from "node:assert/strict";
import test from "node:test";
import { failureFeedback, mayRevealAnswers } from "../../lib/gameplay.ts";

test("failure feedback explains the error without adding a canonical answer", () => {
  const canonical = "show ip interface brief";
  const message = failureFeedback("The command is in the wrong mode.");
  assert.match(message, /wrong mode/i);
  assert.doesNotMatch(message, new RegExp(canonical, "i"));
});

test("answers can be revealed only after the timer reaches zero", () => {
  assert.equal(mayRevealAnswers(false), false);
  assert.equal(mayRevealAnswers(true), true);
});
