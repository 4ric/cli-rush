import type { Command } from "./engine.ts";
import { teachingFor } from "./command-teaching.ts";
import { commandGrammarTokens } from "./cli-grammar.ts";

export interface PreAnswerLearningAid {
  text: string;
  assisted: boolean;
}

export interface EasyLearningHints {
  strategy: PreAnswerLearningAid;
  structure: PreAnswerLearningAid;
  family: PreAnswerLearningAid;
  reveal: PreAnswerLearningAid;
  postAnswerMnemonic: string;
}

export type AssistanceLevel = 0 | 1 | 2 | 3;

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
  if (assistance === 3) return 0;
  const assistanceMultiplier = assistance === 2 ? 0.35 : assistance === 1 ? 0.65 : 1;
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

/** Safe to show after a wrong timed answer because it omits canonical text. */
export const safeCommandContext = (command: Command): CommandContext => ({
  explanation: safeExplanations[command.kind](command.topic),
  useCase: command.kind === "navigation"
    ? "Use it when moving to the prompt required before the next operational step."
    : command.kind === "verification"
      ? "Use it during baseline checks, fault isolation and validation after a change."
      : `Use it when deploying or correcting ${command.topic.toLocaleLowerCase("en-GB")} settings.`,
});

/** Full post-answer explanation for an accepted command. */
export const acceptedCommandContext = (command: Command): CommandContext => {
  const teaching = teachingFor(command);
  return {
    explanation: command.custom ? command.explanation : teaching.purpose,
    useCase: teaching.whenToUse,
  };
};

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

const tokensOf = (canonical: string): string[] =>
  canonical.trim().split(/\s+/u).filter(Boolean);

const valueToken = /^(?:\d|[0-9a-f]*:)|[.:/@#]/iu;

const semanticSlot = (token: string): string =>
  valueToken.test(token) ? "[argument]" : "[keyword]";

/**
 * Exposes token roles without initials, character counts or literal values.
 * This keeps a useful syntax scaffold without turning Tab into answer recovery.
 */
export const maskedCommandShape = (canonical: string): string =>
  tokensOf(canonical).map(semanticSlot).join(" → ");

const semanticCommandShape = (command: Command): string =>
  commandGrammarTokens(command)
    .map((token) => token.kind === "argument" ? "[argument]" : "[keyword]")
    .join(" → ");

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
  const chunkSequence = chunks.map((chunk) => `“${chunk}”`).join(" → ");
  const rhythm = rhythms[command.kind].slice(0, chunks.length).join(" → ");

  return `Chunk the answer as ${chunkSequence}. Recall the rhythm ${rhythm}. ${mnemonicClosings[command.kind]}`;
};

const semanticStructures: Record<Command["kind"], string> = {
  navigation: "Structure: [movement or context] → [destination or scope, if required].",
  verification: "Structure: [read operation] → [feature or subject] → [optional detail].",
  configuration: "Structure: [feature] → [action] → [target] → [value, where required].",
};

export const learningHintsFor = (command: Command): EasyLearningHints => ({
  strategy: {
    text: strategies[command.kind],
    assisted: false,
  },
  structure: {
    text: `${semanticStructures[command.kind]} Token roles: ${semanticCommandShape(command)}`,
    assisted: true,
  },
  family: {
    text: `Command family: ${tokensOf(command.canonical)[0] ?? "not available"}. Build the remaining keywords and arguments from the objective.`,
    assisted: true,
  },
  reveal: {
    text: command.canonical,
    assisted: true,
  },
  postAnswerMnemonic: chunkingMnemonic(command),
});
