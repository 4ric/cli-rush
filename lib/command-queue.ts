import type { Command } from "./engine.ts";

export interface CommandRecallHistory {
  attempts?: number;
  correct?: number;
  assisted?: number;
  revealed?: number;
  lastError?: string | null;
}

export type CommandHistory = Readonly<Record<string, CommandRecallHistory>>;
export type RandomSource = () => number;

const ipv4Address = /(?:^|\s)(?:\d{1,3}\.){3}\d{1,3}(?:\s|$)/u;
const ipv4Keyword = /(?:^|\s)ip(?:v4)?(?:\s|$)/iu;
const ipv6Signal = /ipv6|[0-9a-f]{0,4}:[0-9a-f:]+/iu;

const searchableText = (command: Command): string =>
  `${command.canonical} ${command.objective} ${command.topic}`;

/** Biases the learning mix towards IPv4 while retaining some IPv6 practice. */
export const protocolFocusWeight = (command: Command): number => {
  const text = searchableText(command);
  if (ipv6Signal.test(text)) return 0.35;
  if (ipv4Address.test(` ${text} `) || ipv4Keyword.test(` ${text} `)) return 2;
  return 1;
};

/**
 * Correct recalls return more often as requested, while hints and full reveals
 * receive a stronger boost so assisted material is revisited promptly.
 */
export const commandQueueWeight = (
  command: Command,
  history: CommandRecallHistory | undefined,
): number => {
  const correctBoost = Math.min(12, Math.max(0, history?.correct ?? 0)) * 0.12;
  const assistanceBoost = Math.min(6, Math.max(0, history?.assisted ?? 0)) * 0.45;
  const revealBoost = Math.min(4, Math.max(0, history?.revealed ?? 0)) * 0.9;
  return protocolFocusWeight(command) * (1 + correctBoost + assistanceBoost + revealBoost);
};

const safeRandom = (random: RandomSource): number => {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
};

const pickWeightedIndex = (
  commands: readonly Command[],
  history: CommandHistory,
  random: RandomSource,
): number => {
  const weights = commands.map((command) => commandQueueWeight(command, history[command.id]));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = safeRandom(random) * total;
  for (let index = 0; index < weights.length; index += 1) {
    target -= weights[index];
    if (target < 0) return index;
  }
  return Math.max(0, commands.length - 1);
};

/**
 * Produces a weighted random permutation. The previous opener is excluded from
 * the first draw when another command exists, including after an abandoned run.
 */
export const weightedCommandQueue = (
  catalogue: readonly Command[],
  history: CommandHistory,
  previousFirstId: string | null,
  random: RandomSource = Math.random,
): string[] => {
  const remaining = [...catalogue];
  const queue: string[] = [];
  const previousFirst = remaining.find((command) => command.id === previousFirstId);

  while (remaining.length) {
    const differentOpeningCommands = queue.length === 0 && previousFirstId && remaining.length > 1
      ? remaining.filter((command) =>
          command.id !== previousFirstId
          && (!previousFirst || command.canonical.toLocaleLowerCase("en-GB")
            !== previousFirst.canonical.toLocaleLowerCase("en-GB")))
      : remaining;
    const pool = differentOpeningCommands.length ? differentOpeningCommands : remaining;
    const pickedFromPool = pickWeightedIndex(pool, history, random);
    const picked = pool[pickedFromPool];
    queue.push(picked.id);
    const remainingIndex = remaining.findIndex((command) => command.id === picked.id);
    remaining.splice(remainingIndex, 1);
  }

  return queue;
};
