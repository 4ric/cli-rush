import assert from "node:assert/strict";
import test from "node:test";
import {
  due,
  intervals,
  schedule,
  score,
  updateReview,
} from "../../lib/scheduler.ts";

const now = Date.parse("2026-07-10T12:00:00Z");

test("new clean recall schedules a ten-minute review in any learning mode", () => {
  const review = updateReview(undefined, { kind: "clean", responseMs: 2_500 }, now)!;
  assert.equal(review.stage, 0);
  assert.equal(review.dueAt, now + intervals[0]);
  assert.equal(review.cleanRecalls, 1);
  assert.equal(review.lastResponseMs, 2_500);
});

test("early clean practice records recall without lengthening the interval", () => {
  const first = schedule(undefined, "firstTry", now);
  const early = schedule(first, "firstTry", now + 1_000);
  assert.equal(early.stage, first.stage);
  assert.equal(early.dueAt, first.dueAt);
  assert.equal(early.cleanRecalls, 2);
  assert.equal(early.lastAt, now + 1_000);
});

test("unassisted success advances only at or after the due boundary and caps", () => {
  let review = schedule(undefined, "firstTry", now);
  for (let expectedStage = 1; expectedStage < intervals.length; expectedStage += 1) {
    review = schedule(review, "firstTry", review.dueAt);
    assert.equal(review.stage, expectedStage);
  }
  assert.equal(schedule(review, "firstTry", review.dueAt).stage, intervals.length - 1);
});

test("assisted success creates no mastery and preserves an existing schedule", () => {
  assert.equal(updateReview(undefined, { kind: "assisted" }, now), undefined);
  const previous = schedule(undefined, "firstTry", now);
  assert.equal(updateReview(previous, { kind: "assisted" }, now + 5_000), previous);
});

test("legacy clean evidence survives a later lapse", () => {
  const legacy = schedule(undefined, "firstTry", now);
  delete legacy.cleanRecalls;
  const lapsed = schedule(legacy, "failed", now + 1);
  assert.equal(lapsed.cleanRecalls, 1);
});

test("retry, reveal and failure step back without deleting best stage", () => {
  let review = schedule(undefined, "firstTry", now);
  review = schedule(review, "firstTry", review.dueAt);
  review = schedule(review, "firstTry", review.dueAt);
  assert.equal(review.stage, 2);

  for (const outcome of ["retry", "revealed", "failed"] as const) {
    const lapsed = schedule(review, outcome, review.lastAt + 1);
    assert.equal(lapsed.stage, 0);
    assert.equal(lapsed.bestStage, 2);
    assert.equal(lapsed.dueAt, review.lastAt + 1 + intervals[0]);
    assert.equal(lapsed.lapses, review.lapses + 1);
  }
});

test("due boundary and ordering are stable", () => {
  const base = schedule(undefined, "failed", now);
  const reviews = {
    z: { ...base, dueAt: now + 1_000, lapses: 1 },
    b: { ...base, dueAt: now + 1_000, lapses: 2 },
    a: { ...base, dueAt: now + 1_000, lapses: 2 },
  };
  assert.deepEqual(due(reviews, now + 999), []);
  assert.deepEqual(due(reviews, now + 1_000).map((entry) => entry.id), ["a", "b", "z"]);
});

test("speed and combination bonuses are capped and revealed answers score zero", () => {
  assert.equal(score(1, 1, 0, 20, false), 150);
  assert.equal(score(3, 4, 0, 20, true), 0);
});

test("retry scoring drops without advancing a combination", () => {
  assert.equal(score(1, 1, 8_000, 0, false), 100);
  assert.equal(score(1, 2, 8_000, 0, false), 65);
  assert.equal(score(1, 3, 8_000, 0, false), 30);
});
