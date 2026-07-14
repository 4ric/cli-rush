import type { MasteryOutcome, Outcome, ReviewEvidence } from "./scheduler.ts";
import { redactCredentialInput } from "./command-registry.ts";

export type RoundRecordClass = "clean" | "field" | null;

export const roundAttemptRecordVersion = 1 as const;
export const roundAttemptRecordLimit = 120;

export type RoundAttemptParserCategory =
  | "accepted-objective"
  | "valid-unrelated"
  | "parser-error"
  | "skipped";

export type RoundAttemptMastery =
  | "independent"
  | "recovered"
  | "guided-discovery"
  | "assisted"
  | "revealed"
  | "incorrect"
  | "not-completed"
  | "skipped";

export interface RoundAttemptRecord {
  version: typeof roundAttemptRecordVersion;
  commandId: string;
  task: string;
  learnerInput: string;
  parserCategory: RoundAttemptParserCategory;
  parserReason: string;
  correctCommand: string;
  purpose: string;
  nonCompletionReason: string;
  requiredContext: string;
  verification: string;
  stateEffect: string;
  mastery: RoundAttemptMastery;
}

const controlFormatting = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu;
const safeAttemptText = (value: unknown, maximum: number): string =>
  typeof value === "string" ? value.replace(controlFormatting, "").slice(0, maximum) : "";

/** Defence-in-depth for restored learner input; live input is also redacted by the shared CLI registry. */
export const redactRoundLearnerInput = (value: string): string => {
  return redactCredentialInput(safeAttemptText(value, 512))
    .replaceAll("[redacted]", "<redacted>")
    .slice(0, 512);
};

const parserCategories = new Set<RoundAttemptParserCategory>(["accepted-objective", "valid-unrelated", "parser-error", "skipped"]);
const masteryValues = new Set<RoundAttemptMastery>(["independent", "recovered", "guided-discovery", "assisted", "revealed", "incorrect", "not-completed", "skipped"]);

const safeRoundAttemptRecord = (value: unknown): RoundAttemptRecord | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RoundAttemptRecord>;
  if (candidate.version !== roundAttemptRecordVersion
    || !parserCategories.has(candidate.parserCategory as RoundAttemptParserCategory)
    || !masteryValues.has(candidate.mastery as RoundAttemptMastery)) return null;
  const commandId = safeAttemptText(candidate.commandId, 100);
  const task = safeAttemptText(candidate.task, 300);
  const correctCommand = redactRoundLearnerInput(safeAttemptText(candidate.correctCommand, 256));
  if (!commandId || !task || !correctCommand) return null;
  return {
    version: roundAttemptRecordVersion,
    commandId,
    task,
    learnerInput: redactRoundLearnerInput(candidate.learnerInput ?? ""),
    parserCategory: candidate.parserCategory as RoundAttemptParserCategory,
    parserReason: safeAttemptText(candidate.parserReason, 500),
    correctCommand,
    purpose: safeAttemptText(candidate.purpose, 600),
    nonCompletionReason: safeAttemptText(candidate.nonCompletionReason, 600),
    requiredContext: safeAttemptText(candidate.requiredContext, 160),
    verification: safeAttemptText(candidate.verification, 600),
    stateEffect: safeAttemptText(candidate.stateEffect, 600),
    mastery: candidate.mastery as RoundAttemptMastery,
  };
};

export const restoreRoundAttemptRecords = (value: unknown): RoundAttemptRecord[] =>
  Array.isArray(value)
    ? value.map(safeRoundAttemptRecord).filter((record): record is RoundAttemptRecord => record !== null).slice(-roundAttemptRecordLimit)
    : [];

export const appendRoundAttemptRecord = (
  records: readonly RoundAttemptRecord[],
  value: RoundAttemptRecord,
): RoundAttemptRecord[] => {
  const safe = safeRoundAttemptRecord(value);
  return safe ? [...records, safe].slice(-roundAttemptRecordLimit) : [...records].slice(-roundAttemptRecordLimit);
};

/** Incorrect and skipped answers in timed runs remain hidden until the full timer expires. */
export const roundAttemptAnswerVisible = (
  mode: "easy" | "normal" | "hard" | "hardcore",
  timerExpired: boolean,
  mastery: RoundAttemptMastery,
  commandWasMissed = false,
): boolean => mode === "easy" || timerExpired || !commandWasMissed && !["incorrect", "not-completed", "skipped"].includes(mastery);

export interface AcceptedAttemptPolicy {
  attempt: number;
  outcome: Extract<Outcome, "firstTry" | "retry">;
  firstTry: boolean;
  classification:
    | "clean-recall"
    | "recovered-recall"
    | "guided-discovery"
    | "cli-assisted"
    | "answer-revealed";
  masteryOutcome: MasteryOutcome | "recovered";
  reviewEvidence: ReviewEvidence;
  cleanRecall: boolean;
  operationalSuccess: true;
  operationalRewardEligible: boolean;
  masteryEligible: boolean;
  cleanRecordEligible: boolean;
  roundRecordEligible: boolean;
  reviewOutcome: Extract<Outcome, "firstTry" | "retry" | "guided" | "assisted" | "revealed">;
  combo: number;
}

export interface AttemptAssistance {
  hintUsed?: boolean;
  tabUsed?: boolean;
  helpUsed?: boolean;
  answerRevealed?: boolean;
}

export const acceptedAttemptPolicy = (
  attempt: number,
  currentCombo: number,
  assistance: boolean | AttemptAssistance = false,
): AcceptedAttemptPolicy => {
  const firstTry = attempt === 1;
  const details: AttemptAssistance = typeof assistance === "boolean"
    ? { hintUsed: assistance }
    : assistance;
  const revealed = Boolean(details.answerRevealed);
  const assisted = Boolean(details.hintUsed || details.tabUsed);
  const guided = Boolean(details.helpUsed) && !assisted && !revealed;
  const cleanRecall = firstTry && !assisted && !guided && !revealed;
  const classification: AcceptedAttemptPolicy["classification"] = revealed
    ? "answer-revealed"
    : assisted
      ? "cli-assisted"
      : guided
        ? "guided-discovery"
        : firstTry
          ? "clean-recall"
          : "recovered-recall";
  const reviewEvidence: ReviewEvidence = revealed
    ? { kind: "revealed" }
    : assisted
      ? { kind: "assisted" }
      : guided
        ? { kind: "guided" }
        : firstTry
          ? { kind: "clean" }
          : { kind: "retry" };
  const reviewOutcome: AcceptedAttemptPolicy["reviewOutcome"] = revealed
    ? "revealed"
    : assisted
      ? "assisted"
      : guided
        ? "guided"
        : firstTry
          ? "firstTry"
          : "retry";
  return {
    attempt,
    outcome: firstTry ? "firstTry" : "retry",
    firstTry,
    classification,
    masteryOutcome: revealed
      ? "revealed"
      : assisted
        ? "assisted"
        : guided
          ? "guided-discovery"
          : firstTry
            ? "independent"
            : "recovered",
    reviewEvidence,
    cleanRecall,
    operationalSuccess: true,
    operationalRewardEligible: !revealed,
    masteryEligible: cleanRecall,
    cleanRecordEligible: cleanRecall,
    roundRecordEligible: !assisted && !guided && !revealed,
    reviewOutcome,
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
