import type { Command } from "./engine.ts";

export interface PreAnswerLearningAid {
  text: string;
  assisted: boolean;
}

export interface EasyLearningHints {
  strategy: PreAnswerLearningAid;
  shape: PreAnswerLearningAid;
  reveal: PreAnswerLearningAid;
  postAnswerMnemonic: string;
}

export type AssistanceLevel = 0 | 1 | 2;

export interface CommandContext {
  explanation: string;
  useCase: string;
}

export const learningPoints = (
  difficulty: Command["difficulty"],
  attempt: number,
  streak: number,
  assistance: AssistanceLevel,
): number => {
  if (assistance === 2) return 0;
  const assistanceMultiplier = assistance === 1 ? 0.5 : 1;
  const attemptMultiplier = attempt === 1 ? 1 : 0.6;
  const streakMultiplier = 1 + Math.min(0.25, Math.max(0, streak - 1) * 0.05);
  return Math.round(50 * difficulty * assistanceMultiplier * attemptMultiplier * streakMultiplier);
};

const strategies: Record<Command["kind"], string> = {
  navigation:
    "Picture the CLI prompt before and after the move. Name the destination context in your head, then retrieve the route without looking at command text.",
  verification:
    "Picture the output that would prove the objective. Recall the information family, subject and requested level of detail in that order.",
  configuration:
    "Turn the objective into four roles: feature, action, target and value. Check the current CLI context, then retrieve those roles in order.",
};

const safeExplanations: Record<Command["kind"], (topic: string) => string> = {
  navigation: (topic) =>
    `This is a CLI navigation task for ${topic}. It changes the active prompt or command context without exposing the required answer.`,
  verification: (topic) =>
    `This is a verification task in the ${topic} area. It reads device state so an operator can confirm what the simulator is doing.`,
  configuration: (topic) =>
    `This is a configuration task in the ${topic} area. It changes device state and should be entered from the requested CLI context.`,
};

const useCases: Record<Command["kind"], (topic: string) => string> = {
  navigation: () =>
    "Use it when moving to the prompt required before the next operational step.",
  verification: () =>
    "Use it during baseline checks, fault isolation and validation after a change.",
  configuration: (topic) =>
    `Use it when deploying or correcting ${topic.toLocaleLowerCase("en-GB")} settings.`,
};

/** Safe to show after a wrong timed answer because it omits canonical text. */
export const safeCommandContext = (command: Command): CommandContext => ({
  explanation: safeExplanations[command.kind](command.topic),
  useCase: useCases[command.kind](command.topic),
});

/** Full post-answer explanation for an accepted command. */
export const acceptedCommandContext = (command: Command): CommandContext => ({
  explanation: command.explanation,
  useCase: useCases[command.kind](command.topic),
});

const rhythms: Record<Command["kind"], readonly string[]> = {
  navigation: ["movement", "destination", "scope"],
  verification: ["inspection", "subject", "detail"],
  configuration: ["feature", "action", "value"],
};

const mnemonicClosings: Record<Command["kind"], string> = {
  navigation: "Link the sequence to the prompt change it causes.",
  verification: "Link the sequence to the output you expect to inspect.",
  configuration: "Link the sequence to the state change you expect.",
};

const letterOrNumber = /[\p{L}\p{N}]/u;

const tokensOf = (canonical: string): string[] =>
  canonical.trim().split(/\s+/u).filter(Boolean);

const tokenInitial = (token: string): string =>
  Array.from(token).find((character) => letterOrNumber.test(character)) ?? "•";

const maskedToken = (token: string): string => {
  const length = Array.from(token).length;
  if (length === 0) return "";
  return `${tokenInitial(token)}${"•".repeat(length - 1)}[${length}]`;
};

/**
 * Exposes only each whitespace-delimited token's first letter or digit and its
 * total character count. Every other character, including punctuation, is
 * replaced so addresses and command arguments are not disclosed accidentally.
 */
export const maskedCommandShape = (canonical: string): string =>
  tokensOf(canonical).map(maskedToken).join(" ");

const chunksOf = (tokens: readonly string[]): string[] => {
  if (tokens.length === 0) return [];
  const chunkSize = Math.ceil(tokens.length / 3);
  const chunks: string[] = [];
  for (let index = 0; index < tokens.length; index += chunkSize) {
    chunks.push(tokens.slice(index, index + chunkSize).join(" "));
  }
  return chunks;
};

const chunkingMnemonic = (command: Command): string => {
  const tokens = tokensOf(command.canonical);
  if (tokens.length === 0) {
    return "After answering, rehearse the exact command as one complete unit.";
  }

  const chunks = chunksOf(tokens);
  const orderCue = tokens.map(tokenInitial).join("–");
  const chunkSequence = chunks.map((chunk) => `“${chunk}”`).join(" → ");
  const rhythm = rhythms[command.kind].slice(0, chunks.length).join(" → ");

  return `Use ${orderCue} as the order cue. Chunk the answer as ${chunkSequence}. Recall the rhythm ${rhythm}. ${mnemonicClosings[command.kind]}`;
};

export const learningHintsFor = (command: Command): EasyLearningHints => ({
  strategy: {
    text: strategies[command.kind],
    assisted: false,
  },
  shape: {
    text: maskedCommandShape(command.canonical),
    assisted: true,
  },
  reveal: {
    text: command.canonical,
    assisted: true,
  },
  postAnswerMnemonic: chunkingMnemonic(command),
});
