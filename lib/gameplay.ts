import type { Outcome } from "./scheduler.ts";

export type RoundRecordClass = "clean" | "field" | null;

export interface AcceptedAttemptPolicy {
  attempt: number;
  outcome: Extract<Outcome, "firstTry" | "retry">;
  firstTry: boolean;
  classification: "clean-recall" | "recovered-recall" | "cli-assisted";
  cleanRecall: boolean;
  operationalSuccess: true;
  operationalRewardEligible: true;
  masteryEligible: boolean;
  cleanRecordEligible: boolean;
  roundRecordEligible: boolean;
  reviewOutcome: Extract<Outcome, "firstTry" | "retry"> | null;
  combo: number;
}

export const acceptedAttemptPolicy = (
  attempt: number,
  currentCombo: number,
  assisted = false,
): AcceptedAttemptPolicy => {
  const firstTry = attempt === 1;
  const cleanRecall = firstTry && !assisted;
  return {
    attempt,
    outcome: firstTry ? "firstTry" : "retry",
    firstTry,
    classification: assisted
      ? "cli-assisted"
      : firstTry
        ? "clean-recall"
        : "recovered-recall",
    cleanRecall,
    operationalSuccess: true,
    operationalRewardEligible: true,
    masteryEligible: cleanRecall,
    cleanRecordEligible: cleanRecall,
    roundRecordEligible: !assisted,
    reviewOutcome: assisted ? null : firstTry ? "firstTry" : "retry",
    // A help-assisted answer ends the clean run; it cannot extend a streak.
    combo: cleanRecall ? currentCombo + 1 : 0,
  };
};

/**
 * A run containing any CLI-assisted completion belongs on the operational
 * field board, never the clean-recall board. Empty runs create no record.
 */
export const classifyRoundRecord = (
  resolvedAnswers: number,
  assistedAnswers: number,
): RoundRecordClass => {
  if (resolvedAnswers <= 0) return null;
  return assistedAnswers > 0 ? "field" : "clean";
};

export const failureFeedback = (specificError: string): string =>
  `${specificError} The correct command and full explanation will be shown only when the time bank reaches zero.`;

export const mayRevealAnswers = (timerReachedZero: boolean): boolean => timerReachedZero;

export const shouldRecordTimedOutObjective = (
  timerReachedZero: boolean,
  submittedForCurrentObjective: boolean,
): boolean => timerReachedZero && !submittedForCurrentObjective;
