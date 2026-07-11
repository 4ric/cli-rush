import type { Outcome } from "./scheduler.ts";

export interface AcceptedAttemptPolicy {
  attempt: number;
  outcome: Extract<Outcome, "firstTry" | "retry">;
  firstTry: boolean;
  combo: number;
}

export const acceptedAttemptPolicy = (
  attempt: number,
  currentCombo: number,
): AcceptedAttemptPolicy => {
  const firstTry = attempt === 1;
  return {
    attempt,
    outcome: firstTry ? "firstTry" : "retry",
    firstTry,
    combo: firstTry ? currentCombo + 1 : 0,
  };
};

export const failureFeedback = (specificError: string): string =>
  `${specificError} The correct command and full explanation will be shown only when the time bank reaches zero.`;

export const mayRevealAnswers = (timerReachedZero: boolean): boolean => timerReachedZero;

export const shouldRecordTimedOutObjective = (
  timerReachedZero: boolean,
  submittedForCurrentObjective: boolean,
): boolean => timerReachedZero && !submittedForCurrentObjective;
