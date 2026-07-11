import assert from "node:assert/strict";
import test from "node:test";
import {
  beginnerStages,
  buildBeginnerCurriculum,
  curriculumProgress,
  nextCurriculumChapter,
} from "../../lib/curriculum.ts";
import { commands, type Command } from "../../lib/engine.ts";
import type { Review } from "../../lib/scheduler.ts";

const stageOrder = beginnerStages.map((stage) => stage.id);

const cleanReview = (overrides: Partial<Review> = {}): Review => ({
  stage: 0,
  dueAt: Date.now() + 600_000,
  lastAt: Date.now(),
  lapses: 0,
  bestStage: 0,
  outcome: "firstTry",
  cleanRecalls: 1,
  ...overrides,
});

test("beginner curriculum is ordered, prerequisite-gated and chapter-sized", () => {
  const curriculum = buildBeginnerCurriculum(commands);
  const knownIds = new Set(commands.map((command) => command.id));
  const chapterIds = new Set<string>();
  const includedIds = new Set<string>();
  let lastStageAt = -1;

  assert.ok(curriculum.chapters.length > beginnerStages.length);
  for (const [index, chapter] of curriculum.chapters.entries()) {
    assert.ok(chapter.commandIds.length > 0);
    assert.ok(chapter.commandIds.length <= 6);
    assert.equal(chapter.sequence, index);
    assert.deepEqual(chapter.prerequisiteIds, index ? [curriculum.chapters[index - 1].id] : []);
    assert.equal(chapterIds.has(chapter.id), false);
    chapterIds.add(chapter.id);

    const stageAt = stageOrder.indexOf(chapter.stageId);
    assert.ok(stageAt >= lastStageAt);
    lastStageAt = stageAt;
    for (const id of chapter.commandIds) {
      assert.equal(knownIds.has(id), true, id);
      assert.equal(includedIds.has(id), false, id);
      includedIds.add(id);
    }
  }
  assert.deepEqual([...includedIds], curriculum.includedCommandIds);
  assert.equal(
    curriculum.includedCommandIds.length + curriculum.libraryCommandIds.length,
    commands.length,
  );
  assert.equal(curriculum.includedCommandIds.some((id) => id.includes("ipv6")), false);
});

test("curriculum membership and chapter counts are derived from the catalogue", () => {
  const baseline = buildBeginnerCurriculum(commands, 10);
  const added: Command = {
    id: "test.derived-navigation",
    mode: "user",
    canonical: "enable",
    objective: "Enter privileged EXEC mode in a second lab context.",
    explanation: "Test-only catalogue entry.",
    topic: "CLI navigation",
    kind: "navigation",
    difficulty: 1,
  };
  const expanded = buildBeginnerCurriculum([...commands, added], 10);
  assert.equal(expanded.includedCommandIds.length, baseline.includedCommandIds.length + 1);
  assert.equal(expanded.includedCommandIds.includes(added.id), true);
});

test("only clean recall completes a chapter and unlocks its prerequisite successor", () => {
  const curriculum = buildBeginnerCurriculum(commands, 3);
  const first = curriculum.chapters[0];
  const second = curriculum.chapters[1];
  const noReviews = curriculumProgress(curriculum, {});
  assert.equal(noReviews[0].unlocked, true);
  assert.equal(noReviews[0].complete, false);
  assert.equal(noReviews[1].unlocked, false);
  assert.equal(nextCurriculumChapter(curriculum, {})?.chapter.id, first.id);

  const failedReviews = Object.fromEntries(
    first.commandIds.map((id) => [id, cleanReview({
      outcome: "failed",
      cleanRecalls: 0,
      lapses: 1,
    })]),
  );
  assert.equal(curriculumProgress(curriculum, failedReviews)[0].complete, false);

  const laterOnlyReviews = Object.fromEntries(
    second.commandIds.map((id) => [id, cleanReview()]),
  );
  const laterOnly = curriculumProgress(curriculum, laterOnlyReviews);
  assert.equal(laterOnly[1].complete, false);
  assert.equal(laterOnly[2].unlocked, false);

  const cleanReviews = Object.fromEntries(
    first.commandIds.map((id) => [id, cleanReview()]),
  );
  const progressed = curriculumProgress(curriculum, cleanReviews);
  assert.equal(progressed[0].complete, true);
  assert.equal(progressed[1].unlocked, true);
  assert.equal(nextCurriculumChapter(curriculum, cleanReviews)?.chapter.id, second.id);
});
