import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedAttemptPolicy,
  appendRoundAttemptRecord,
  classifyRoundRecord,
  failureFeedback,
  mayRevealAnswers,
  redactRoundLearnerInput,
  restoreRoundAttemptRecords,
  roundAttemptAnswerVisible,
  roundAttemptRecordLimit,
  roundAttemptRecordVersion,
  shouldRecordTimedOutObjective,
  type RoundAttemptRecord,
} from "../../lib/gameplay.ts";

const attempt = (index = 1, overrides: Partial<RoundAttemptRecord> = {}): RoundAttemptRecord => ({
  version: roundAttemptRecordVersion,
  commandId: `show.${index}`,
  task: `Inspect state ${index}.`,
  learnerInput: "show version",
  parserCategory: "accepted-objective",
  parserReason: "The command completed the objective.",
  correctCommand: "show version",
  purpose: "Inspect the declared training platform.",
  nonCompletionReason: "None; the operational outcome completed.",
  requiredContext: "Privileged EXEC",
  verification: "Read the platform and software evidence.",
  stateEffect: "Read-only output; simulated state was unchanged.",
  mastery: "independent",
  ...overrides,
});

test("a clean first recall can advance mastery, records and combination", () => {
  const policy = acceptedAttemptPolicy(1, 4);
  assert.equal(policy.classification, "clean-recall");
  assert.equal(policy.masteryOutcome, "independent");
  assert.deepEqual(policy.reviewEvidence, { kind: "clean" });
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
  assert.equal(policy.masteryOutcome, "recovered");
  assert.deepEqual(policy.reviewEvidence, { kind: "retry" });
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
  assert.equal(policy.masteryOutcome, "assisted");
  assert.deepEqual(policy.reviewEvidence, { kind: "assisted" });
  assert.equal(policy.operationalSuccess, true);
  assert.equal(policy.operationalRewardEligible, true);
  assert.equal(policy.masteryEligible, false);
  assert.equal(policy.cleanRecordEligible, false);
  assert.equal(policy.roundRecordEligible, false);
  assert.equal(policy.reviewOutcome, "assisted");
  assert.equal(policy.combo, 0);
});

test("guided discovery and answer reveal remain distinct from Tab or Hint", () => {
  const guided = acceptedAttemptPolicy(1, 3, { helpUsed: true });
  assert.equal(guided.classification, "guided-discovery");
  assert.equal(guided.masteryOutcome, "guided-discovery");
  assert.deepEqual(guided.reviewEvidence, { kind: "guided" });
  assert.equal(guided.masteryEligible, false);
  assert.equal(guided.operationalRewardEligible, true);
  assert.equal(guided.combo, 0);

  const revealed = acceptedAttemptPolicy(1, 3, { answerRevealed: true });
  assert.equal(revealed.classification, "answer-revealed");
  assert.equal(revealed.masteryOutcome, "revealed");
  assert.deepEqual(revealed.reviewEvidence, { kind: "revealed" });
  assert.equal(revealed.operationalRewardEligible, false);
  assert.equal(revealed.masteryEligible, false);
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

test("per-submission records are versioned, bounded and redact restored secrets", () => {
  assert.deepEqual(restoreRoundAttemptRecords(undefined), [], "legacy rounds without records migrate without losing the round");
  let records: RoundAttemptRecord[] = [];
  for (let index = 0; index < roundAttemptRecordLimit + 20; index += 1) {
    records = appendRoundAttemptRecord(records, attempt(index, {
      learnerInput: `username test secret 0 value-${index}`,
    }));
  }
  assert.equal(records.length, roundAttemptRecordLimit);
  assert.equal(records[0].commandId, "show.20");
  assert.equal(records.at(-1)?.learnerInput, "username test secret 0 <redacted>");

  const restored = restoreRoundAttemptRecords([
    attempt(1, { learnerInput: "snmp-server community private RO", correctCommand: "enable secret 0 SavedValue" }),
    { ...attempt(2), version: 999 },
    { unsafe: true },
  ]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].learnerInput, "snmp-server community <redacted> RO");
  assert.equal(restored[0].correctCommand, "enable secret 0 <redacted>");
  assert.equal(redactRoundLearnerInput("radius server RAD key Pa55word"), "radius server RAD key <redacted>");
  assert.equal(redactRoundLearnerInput("enable secret 0 First Second Third"), "enable secret 0 <redacted>");
  assert.equal(redactRoundLearnerInput("password 0 First Second"), "password 0 <redacted>");
  assert.equal(redactRoundLearnerInput("radius server R1 key 0 First Second"), "radius server R1 key 0 <redacted>");
  assert.equal(redactRoundLearnerInput("crypto key generate rsa modulus 2048"), "crypto key generate rsa modulus 2048");
});

test("missed answers are revealed only after a full timer expiry", () => {
  for (const mastery of ["incorrect", "not-completed", "skipped"] as const) {
    assert.equal(roundAttemptAnswerVisible("normal", false, mastery), false, `early ${mastery}`);
    assert.equal(roundAttemptAnswerVisible("hardcore", false, mastery), false, `hardcore ${mastery}`);
    assert.equal(roundAttemptAnswerVisible("hard", true, mastery), true, `timer ${mastery}`);
  }
  assert.equal(roundAttemptAnswerVisible("normal", false, "independent"), true);
  assert.equal(roundAttemptAnswerVisible("normal", false, "recovered", true), false, "a recovered command that was missed earlier remains hidden");
  assert.equal(roundAttemptAnswerVisible("normal", true, "recovered", true), true);
  assert.equal(roundAttemptAnswerVisible("easy", false, "incorrect"), true);
});
