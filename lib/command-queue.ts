import type { Command } from "./engine.ts";
import type { Review } from "./scheduler.ts";

export interface CommandRecallHistory {
  attempts?: number;
  correct?: number;
  /** Independent, first-attempt recalls. */
  firstTry?: number;
  assisted?: number;
  revealed?: number;
  lastError?: string | null;
  review?: Review;
  lastResponseMs?: number;
  averageResponseMs?: number;
}

export type CommandHistory = Readonly<Record<string, CommandRecallHistory>>;
export type RandomSource = () => number;
export type QueueBucket = "priority" | "new" | "retained";

export interface QueueMix {
  priority: number;
  new: number;
  retained: number;
}

export interface CommandQueueOptions {
  now?: number;
  limit?: number;
  currentTopics?: readonly string[];
  mix?: QueueMix;
}

export interface AdaptiveSessionOptions extends CommandQueueOptions {
  previousFirstId?: string | null;
  random?: RandomSource;
}

export interface DailyRecallOptions {
  now: number;
  limit?: number;
  previousFirstId?: string | null;
}

export const DEFAULT_SESSION_SIZE = 20;
export const DEFAULT_DAILY_RECALL_SIZE = 10;
export const DEFAULT_QUEUE_MIX: QueueMix = {
  priority: 0.6,
  new: 0.2,
  retained: 0.2,
};

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

const nonNegative = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

const cleanRecallCount = (history: CommandRecallHistory | undefined): number =>
  Math.max(
    nonNegative(history?.firstTry),
    nonNegative(history?.review?.cleanRecalls),
  );

const assistanceDebt = (history: CommandRecallHistory | undefined): number =>
  Math.max(
    0,
    nonNegative(history?.assisted)
      + nonNegative(history?.revealed)
      - cleanRecallCount(history),
  );

const responseTime = (history: CommandRecallHistory | undefined): number | null => {
  const value = history?.averageResponseMs ?? history?.lastResponseMs
    ?? history?.review?.lastResponseMs;
  return Number.isFinite(value) ? Math.max(0, value!) : null;
};

const isUnseen = (history: CommandRecallHistory | undefined): boolean =>
  !history?.review
  && nonNegative(history?.attempts) === 0
  && nonNegative(history?.correct) === 0
  && nonNegative(history?.assisted) === 0
  && nonNegative(history?.revealed) === 0;

/**
 * Separates due or fragile material from unseen and retained material. Correct
 * totals alone never make a command more urgent; only independent recall is
 * evidence of retention.
 */
export const commandQueueBucket = (
  history: CommandRecallHistory | undefined,
  now: number,
): QueueBucket => {
  if (isUnseen(history)) return "new";

  const review = history?.review;
  const dueNow = Boolean(review && review.dueAt <= now);
  const attempts = nonNegative(history?.attempts);
  const clean = cleanRecallCount(history);
  const fragileAccuracy = attempts >= 2 && clean / attempts < 0.7;
  const slow = (responseTime(history) ?? 0) > 8_000;
  const recentSetback = Boolean(review && review.outcome !== "firstTry");

  if (
    dueNow
    || Boolean(history?.lastError)
    || assistanceDebt(history) > 0
    || fragileAccuracy
    || slow
    || recentSetback
  ) {
    return "priority";
  }
  return "retained";
};

/**
 * Weight within a queue bucket. Overdue, lapsed, slow and assisted material is
 * favoured. Repeated clean correctness gently lowers—not raises—the weight.
 */
export const commandQueueWeight = (
  command: Command,
  history: CommandRecallHistory | undefined,
  now = Date.now(),
): number => {
  const review = history?.review;
  const clean = cleanRecallCount(history);
  const attempts = nonNegative(history?.attempts);
  const cleanAccuracy = attempts ? Math.min(1, clean / attempts) : 0;
  const debt = assistanceDebt(history);
  const latency = responseTime(history);

  const overdueMs = review ? Math.max(0, now - review.dueAt) : 0;
  const overdueDays = overdueMs / 86_400_000;
  const dueBoost = review && review.dueAt <= now
    ? 2 + Math.min(2, overdueDays * 0.25)
    : 0;
  const lapseBoost = Math.min(4, nonNegative(review?.lapses)) * 0.35;
  const assistanceBoost = Math.min(4, debt) * 0.7;
  const errorBoost = history?.lastError ? 1.1 : 0;
  const accuracyBoost = attempts >= 2 ? (1 - cleanAccuracy) * 1.2 : 0;
  const latencyBoost = latency === null ? 0 : Math.min(1, Math.max(0, latency - 8_000) / 8_000);
  const retainedDiscount = Math.min(0.55, clean * 0.08 * cleanAccuracy);

  const learningWeight = Math.max(
    0.35,
    1
      + dueBoost
      + lapseBoost
      + assistanceBoost
      + errorBoost
      + accuracyBoost
      + latencyBoost
      - retainedDiscount,
  );
  return protocolFocusWeight(command) * learningWeight;
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
  now: number,
  currentTopics: ReadonlySet<string>,
): number => {
  const weights = commands.map((command) => {
    const currentTopicBoost = currentTopics.has(command.topic) ? 1.5 : 1;
    return commandQueueWeight(command, history[command.id], now) * currentTopicBoost;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = safeRandom(random) * total;
  for (let index = 0; index < weights.length; index += 1) {
    target -= weights[index];
    if (target < 0) return index;
  }
  return Math.max(0, commands.length - 1);
};

const normalisedMix = (mix: QueueMix): QueueMix => {
  const safe = {
    priority: nonNegative(mix.priority),
    new: nonNegative(mix.new),
    retained: nonNegative(mix.retained),
  };
  const total = safe.priority + safe.new + safe.retained;
  return total > 0
    ? {
        priority: safe.priority / total,
        new: safe.new / total,
        retained: safe.retained / total,
      }
    : DEFAULT_QUEUE_MIX;
};

const bucketOrder: readonly QueueBucket[] = ["priority", "new", "retained"];
const bucketPattern: readonly QueueBucket[] = [
  "priority",
  "priority",
  "priority",
  "new",
  "retained",
];

const allocateQuotas = (
  capacities: Readonly<Record<QueueBucket, number>>,
  limit: number,
  mix: QueueMix,
): Record<QueueBucket, number> => {
  const raw = {
    priority: limit * mix.priority,
    new: limit * mix.new,
    retained: limit * mix.retained,
  };
  const quotas: Record<QueueBucket, number> = {
    priority: Math.min(capacities.priority, Math.floor(raw.priority)),
    new: Math.min(capacities.new, Math.floor(raw.new)),
    retained: Math.min(capacities.retained, Math.floor(raw.retained)),
  };

  while (quotas.priority + quotas.new + quotas.retained < limit) {
    const candidates = bucketOrder.filter((bucket) => quotas[bucket] < capacities[bucket]);
    if (!candidates.length) break;
    candidates.sort((left, right) =>
      (raw[right] - quotas[right]) - (raw[left] - quotas[left])
      || bucketOrder.indexOf(left) - bucketOrder.indexOf(right));
    quotas[candidates[0]] += 1;
  }
  return quotas;
};

const differentFromPrevious = (
  command: Command,
  previous: Command | undefined,
): boolean => !previous
  || (
    command.id !== previous.id
    && command.canonical.toLocaleLowerCase("en-GB")
      !== previous.canonical.toLocaleLowerCase("en-GB")
  );

/** Builds a bounded, mixed session with no duplicate objectives. */
export const buildAdaptiveCommandSession = (
  catalogue: readonly Command[],
  history: CommandHistory,
  options: AdaptiveSessionOptions = {},
): string[] => {
  if (!catalogue.length) return [];

  const now = options.now ?? Date.now();
  const limit = Math.min(
    catalogue.length,
    Math.max(1, Math.floor(options.limit ?? DEFAULT_SESSION_SIZE)),
  );
  const random = options.random ?? Math.random;
  const mix = normalisedMix(options.mix ?? DEFAULT_QUEUE_MIX);
  const currentTopics = new Set(options.currentTopics ?? []);
  const previous = catalogue.find((command) => command.id === options.previousFirstId);
  const pools: Record<QueueBucket, Command[]> = {
    priority: [],
    new: [],
    retained: [],
  };
  for (const command of catalogue) {
    pools[commandQueueBucket(history[command.id], now)].push(command);
  }

  const quotas = allocateQuotas({
    priority: pools.priority.length,
    new: pools.new.length,
    retained: pools.retained.length,
  }, limit, mix);
  const queue: string[] = [];
  let patternAt = 0;

  while (queue.length < limit) {
    let preferred = bucketPattern[patternAt % bucketPattern.length];
    patternAt += 1;
    if (quotas[preferred] <= 0) {
      preferred = bucketOrder.find((bucket) => quotas[bucket] > 0) ?? preferred;
    }

    const firstDraw = queue.length === 0 && catalogue.length > 1;
    const usableBuckets = [preferred, ...bucketOrder.filter((bucket) => bucket !== preferred)]
      .filter((bucket, index, values) => values.indexOf(bucket) === index)
      .filter((bucket) => quotas[bucket] > 0)
      .filter((bucket) =>
        !firstDraw || pools[bucket].some((command) => differentFromPrevious(command, previous)));
    const bucket = usableBuckets[0]
      ?? bucketOrder.find((candidate) => quotas[candidate] > 0);
    if (!bucket) break;

    const pool = firstDraw
      ? pools[bucket].filter((command) => differentFromPrevious(command, previous))
      : pools[bucket];
    const pickedAt = pickWeightedIndex(pool, history, random, now, currentTopics);
    const picked = pool[pickedAt];
    if (!picked) break;
    queue.push(picked.id);
    quotas[bucket] -= 1;
    const sourceAt = pools[bucket].findIndex((command) => command.id === picked.id);
    pools[bucket].splice(sourceAt, 1);
  }

  return queue;
};

/**
 * Compatibility wrapper used by the game screen. The returned session is
 * bounded and follows the same adaptive 60/20/20 mix.
 */
export const weightedCommandQueue = (
  catalogue: readonly Command[],
  history: CommandHistory,
  previousFirstId: string | null,
  random: RandomSource = Math.random,
  options: CommandQueueOptions = {},
): string[] => buildAdaptiveCommandSession(catalogue, history, {
  ...options,
  previousFirstId,
  random,
});

/**
 * Returns only reviews that are due now, oldest and most lapsed first. It does
 * not pad the list with new work, so “Daily Recall complete” remains truthful.
 */
export const buildDailyRecallSession = (
  catalogue: readonly Command[],
  history: CommandHistory,
  options: DailyRecallOptions,
): string[] => {
  const knownIds = new Set(catalogue.map((command) => command.id));
  const previous = catalogue.find((command) => command.id === options.previousFirstId);
  const dueEntries = Object.entries(history)
    .filter(([id, entry]) => knownIds.has(id) && entry.review && entry.review.dueAt <= options.now)
    .sort(([leftId, left], [rightId, right]) => {
      const leftReview = left.review!;
      const rightReview = right.review!;
      return leftReview.dueAt - rightReview.dueAt
        || rightReview.lapses - leftReview.lapses
        || commandQueueWeight(
          catalogue.find((command) => command.id === rightId)!,
          right,
          options.now,
        ) - commandQueueWeight(
          catalogue.find((command) => command.id === leftId)!,
          left,
          options.now,
        )
        || leftId.localeCompare(rightId);
    });

  if (dueEntries.length > 1 && previous) {
    const differentAt = dueEntries.findIndex(([id]) => {
      const command = catalogue.find((entry) => entry.id === id)!;
      return differentFromPrevious(command, previous);
    });
    if (differentAt > 0) {
      const [different] = dueEntries.splice(differentAt, 1);
      dueEntries.unshift(different);
    }
  }

  const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_DAILY_RECALL_SIZE));
  return dueEntries.slice(0, limit).map(([id]) => id);
};
