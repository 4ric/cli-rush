export const intervals = [
  600_000,
  86_400_000,
  259_200_000,
  604_800_000,
  1_209_600_000,
  2_592_000_000,
] as const;

export type Outcome =
  | "firstTry"
  | "retry"
  | "guided"
  | "assisted"
  | "revealed"
  | "failed"
  | "skipped";

export interface Review {
  stage: number;
  dueAt: number;
  lastAt: number;
  lapses: number;
  bestStage: number;
  outcome: Outcome;
  /** Clean, first-attempt recalls only. Older persisted reviews may omit it. */
  cleanRecalls?: number;
  /** Optional fluency evidence used by the adaptive queue. */
  lastResponseMs?: number;
}

export type ReviewEvidence =
  | { kind: "clean"; responseMs?: number }
  | { kind: "guided"; responseMs?: number }
  | { kind: "retry"; responseMs?: number }
  | { kind: "revealed" }
  | { kind: "failed" }
  | { kind: "skipped" }
  | { kind: "assisted"; responseMs?: number };

export type MasteryOutcome =
  | "independent"
  | "guided-discovery"
  | "assisted"
  | "revealed"
  | "incorrect"
  | "skipped";

const cappedStage = (stage: number): number =>
  Math.max(0, Math.min(stage, intervals.length - 1));

const previousCleanRecalls = (previous: Review | undefined): number => {
  if (!previous) return 0;
  if (previous.cleanRecalls !== undefined) return previous.cleanRecalls;
  // Preserve evidence from reviews persisted before this counter existed.
  return previous.outcome === "firstTry" || previous.bestStage > 0 ? 1 : 0;
};

const reviewAtStage = (
  previous: Review | undefined,
  stage: number,
  outcome: Outcome,
  now: number,
  cleanRecalls: number,
  responseMs?: number,
  lapse = outcome === "retry" || outcome === "revealed" || outcome === "failed" || outcome === "skipped",
): Review => ({
  stage,
  dueAt: now + intervals[stage],
  lastAt: now,
  lapses: (previous?.lapses ?? 0) + (lapse ? 1 : 0),
  bestStage: Math.max(previous?.bestStage ?? 0, stage),
  outcome,
  cleanRecalls,
  ...(responseMs === undefined ? {} : { lastResponseMs: responseMs }),
});

/**
 * Applies one piece of learning evidence to a review.
 *
 * Assistance is useful operational practice, but it is not clean retrieval
 * evidence. Guided discovery and assisted success therefore create a short
 * clean-recall check without advancing the mastery stage. A clean recall before
 * its due time records practice without moving the due date. This prevents
 * repeated same-session answers from racing through the spacing stages.
 */
export const updateReview = (
  previous: Review | undefined,
  evidence: ReviewEvidence,
  now: number,
): Review | undefined => {
  if (evidence.kind === "clean") {
    const cleanRecalls = previousCleanRecalls(previous) + 1;
    if (!previous) {
      return reviewAtStage(undefined, 0, "firstTry", now, cleanRecalls, evidence.responseMs);
    }

    if (now < previous.dueAt) {
      return {
        ...previous,
        lastAt: now,
        outcome: "firstTry",
        cleanRecalls,
        ...(evidence.responseMs === undefined ? {} : { lastResponseMs: evidence.responseMs }),
      };
    }

    const nextStage = cappedStage(previous.stage + 1);
    return reviewAtStage(previous, nextStage, "firstTry", now, cleanRecalls, evidence.responseMs);
  }

  if (evidence.kind === "guided" || evidence.kind === "assisted") {
    const outcome: Outcome = evidence.kind === "guided" ? "guided" : "assisted";
    const stage = cappedStage(previous?.stage ?? 0);
    return reviewAtStage(
      previous,
      stage,
      outcome,
      now,
      previousCleanRecalls(previous),
      evidence.responseMs,
      false,
    );
  }

  const outcome: Outcome = evidence.kind;
  const nextStage = cappedStage((previous?.stage ?? 0) - 2);
  return reviewAtStage(
    previous,
    nextStage,
    outcome,
    now,
    previousCleanRecalls(previous),
    "responseMs" in evidence ? evidence.responseMs : undefined,
  );
};

/** Maps player-facing evidence names to the deterministic review schedule. */
export const updateReviewForMastery = (
  previous: Review | undefined,
  outcome: MasteryOutcome,
  now: number,
  responseMs?: number,
): Review | undefined => {
  switch (outcome) {
    case "independent": return updateReview(previous, { kind: "clean", responseMs }, now);
    case "guided-discovery": return updateReview(previous, { kind: "guided", responseMs }, now);
    case "assisted": return updateReview(previous, { kind: "assisted", responseMs }, now);
    case "revealed": return updateReview(previous, { kind: "revealed" }, now);
    case "incorrect": return updateReview(previous, { kind: "failed" }, now);
    case "skipped": return updateReview(previous, { kind: "skipped" }, now);
  }
};

/**
 * Backwards-compatible scheduler entry point. `firstTry` means a clean,
 * unassisted recall. Use `updateReview` when assistance must be represented.
 */
export const schedule = (
  previous: Review | undefined,
  outcome: Outcome,
  now: number,
  responseMs?: number,
): Review => {
  const evidence: ReviewEvidence = outcome === "firstTry"
    ? { kind: "clean", responseMs }
    : outcome === "guided"
      ? { kind: "guided", responseMs }
      : outcome === "assisted"
        ? { kind: "assisted", responseMs }
    : outcome === "retry"
      ? { kind: "retry", responseMs }
      : { kind: outcome };
  return updateReview(previous, evidence, now)!;
};

export const due = (
  reviews: Readonly<Record<string, Review>>,
  now: number,
): Array<{ id: string; review: Review }> =>
  Object.entries(reviews)
    .filter(([, review]) => review.dueAt <= now)
    .map(([id, review]) => ({ id, review }))
    .sort((left, right) =>
      left.review.dueAt - right.review.dueAt
      || right.review.lapses - left.review.lapses
      || left.id.localeCompare(right.id));

export const nextDue = (reviews: Readonly<Record<string, Review>>): number | null => {
  const values = Object.values(reviews).map((review) => review.dueAt);
  return values.length ? Math.min(...values) : null;
};

export const score = (
  difficulty: number,
  attempt: number,
  responseMs: number,
  combo: number,
  revealed: boolean,
): number => {
  if (revealed) return 0;
  const attemptMultiplier = attempt === 1 ? 1 : attempt === 2 ? 0.65 : 0.3;
  const speedMultiplier = attempt === 1
    ? 1 + Math.max(0, Math.min(0.15, ((8_000 - responseMs) / 8_000) * 0.15))
    : 1;
  const comboMultiplier = combo >= 8 ? 1.3 : combo >= 5 ? 1.2 : combo >= 3 ? 1.1 : 1;
  const difficultyMultiplier = difficulty === 3 ? 1.5 : difficulty === 2 ? 1.25 : 1;
  return Math.round(
    100 * difficultyMultiplier * attemptMultiplier * speedMultiplier * comboMultiplier,
  );
};
