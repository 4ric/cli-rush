import type { Command } from "./engine.ts";
import { commandGrammarTokens } from "./cli-grammar.ts";
import { learningTaskFor } from "./learning-tasks.ts";
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
  /**
   * Commands immediately before this queue, oldest first. Supplying these is
   * important when a live round appends another shuffle bag because those
   * commands may no longer be present in the remaining catalogue.
   */
  recentCommands?: readonly Command[];
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
export const SEMANTIC_COOLDOWN_SIZE = 8;

export const easyPracticeCatalogue = (
  catalogue: readonly Command[],
  currentChapterIds: readonly string[],
): Command[] => {
  const chapterIds = new Set(currentChapterIds);
  const outsideChapter = catalogue.filter((command) => !chapterIds.has(command.id));
  return outsideChapter.length ? outsideChapter : [...catalogue];
};
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

export interface CommandEquivalence {
  taskId: string;
  conceptId: string;
  canonical: string;
  family: string;
  taskText: string;
  navigationAction: string | null;
}

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");

const collapseText = (value: string): string => lower(value)
  .normalize("NFKC")
  .replace(/[\u2010-\u2015]/gu, "-")
  .replace(/\s+/gu, " ")
  .trim();

/**
 * Removes seeded values while retaining the wording that describes the
 * learning outcome. This prevents a changed address, VLAN or interface number
 * from disguising the same task in a later catalogue entry.
 */
const normalisedTaskText = (value: string): string => collapseText(value)
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,3})?\b/gu, "<ipv4>")
  .replace(/\b[0-9a-f]{0,4}:[0-9a-f:]+(?:\/\d{1,3})?\b/giu, "<ipv6>")
  .replace(/\b(?:fastethernet|gigabitethernet|tengigabitethernet|fortygigabitethernet|hundredgige|ethernet|fa|gi|te|fo|hu|port-channel|po|vlan)\s*\d+(?:\/\d+)*(?:\.\d+)?\b/giu, "<interface>")
  .replace(/\b\d+\b/gu, "<number>")
  .replace(/\s+/gu, " ")
  .trim();

const normalisedConceptId = (value: string): string => collapseText(value)
  .replace(/(?:^|[.-])\d+(?=$|[.-])/gu, ".<number>")
  .replace(/\.{2,}/gu, ".");

const commandShape = (command: Command): string => commandGrammarTokens(command)
  .map((token) => token.kind === "keyword"
    ? lower(token.source)
    : `<${token.argumentKind ?? "argument"}>`)
  .join(" ");

const primaryFamily = (command: Command): string => {
  const keywords = commandGrammarTokens(command)
    .filter((token) => token.kind === "keyword")
    .map((token) => lower(token.source))
    .filter((token) => token !== "no" && token !== "do");
  if (!keywords.length) return "unknown";
  if (command.kind === "navigation" && (keywords[0] === "exit" || keywords[0] === "end")) {
    return "navigation-leave-configuration";
  }
  // Two structural keywords distinguish useful broad families such as
  // `show ip`, `ip route` and `switchport mode` without treating every show
  // command as one enormous family.
  return keywords.slice(0, 2).join(" ");
};

const navigationAction = (command: Command): string | null => {
  if (command.kind !== "navigation") return null;
  const first = collapseText(command.canonical).split(" ")[0];
  // In a recall queue both forms teach leaving configuration scope. They are
  // kept apart even though their exact state transitions differ in the engine.
  if (first === "exit" || first === "end") return "leave-configuration";
  return null;
};

const equivalenceCache = new WeakMap<Command, CommandEquivalence>();

/** Stable semantic keys used by queue cooldown and its property tests. */
export const commandEquivalence = (command: Command): CommandEquivalence => {
  const cached = equivalenceCache.get(command);
  if (cached) return cached;
  const task = learningTaskFor(command);
  const result = {
    taskId: task.id,
    conceptId: normalisedConceptId(task.conceptId),
    canonical: commandShape(command),
    family: primaryFamily(command),
    taskText: normalisedTaskText(task.task),
    navigationAction: navigationAction(command),
  };
  equivalenceCache.set(command, result);
  return result;
};

const equivalenceKeysMatch = (a: CommandEquivalence, b: CommandEquivalence): boolean =>
  a.taskId === b.taskId
    || a.conceptId === b.conceptId
    || a.canonical === b.canonical
    || a.family === b.family
    || a.taskText === b.taskText
    || Boolean(a.navigationAction && a.navigationAction === b.navigationAction);

export const commandsAreEquivalent = (left: Command, right: Command): boolean =>
  equivalenceKeysMatch(commandEquivalence(left), commandEquivalence(right));

const namespacedEquivalenceKeys = (command: Command): string[] => {
  const keys = commandEquivalence(command);
  return [
    `task:${keys.taskId}`,
    `concept:${keys.conceptId}`,
    `canonical:${keys.canonical}`,
    `family:${keys.family}`,
    `text:${keys.taskText}`,
    ...(keys.navigationAction ? [`navigation:${keys.navigationAction}`] : []),
  ];
};

const incrementEquivalenceCounts = (
  counts: Map<string, number>,
  command: Command,
  amount: 1 | -1,
): void => {
  for (const key of namespacedEquivalenceKeys(command)) {
    const next = (counts.get(key) ?? 0) + amount;
    if (next > 0) counts.set(key, next);
    else counts.delete(key);
  }
};

const equivalencePressure = (counts: ReadonlyMap<string, number>, command: Command): number =>
  Math.max(...namespacedEquivalenceKeys(command).map((key) => counts.get(key) ?? 0));

const outsideCooldown = (
  command: Command,
  recent: readonly Command[],
): boolean => recent.every((previous) => !commandsAreEquivalent(command, previous));

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

const orderedBuckets = (preferred: QueueBucket): QueueBucket[] => [
  preferred,
  ...bucketOrder.filter((bucket) => bucket !== preferred),
];

const recentTail = (commands: readonly Command[]): Command[] =>
  commands.slice(-SEMANTIC_COOLDOWN_SIZE);

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
  const recent = recentTail(options.recentCommands?.length
    ? options.recentCommands
    : previous ? [previous] : []);
  const pools: Record<QueueBucket, Command[]> = {
    priority: [],
    new: [],
    retained: [],
  };
  for (const command of catalogue) {
    pools[commandQueueBucket(history[command.id], now)].push(command);
  }
  const remainingEquivalence = new Map<string, number>();
  for (const command of catalogue) incrementEquivalenceCounts(remainingEquivalence, command, 1);

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

    const recentWindow = recentTail(recent);
    const allSafeBuckets = orderedBuckets(preferred)
      .filter((bucket) => pools[bucket].some((command) => outsideCooldown(command, recentWindow)));
    const quotaSafeBuckets = allSafeBuckets.filter((bucket) => quotas[bucket] > 0);
    // The 60/20/20 split is a target, not permission to repeat a concept. If
    // only a bucket whose quota is exhausted contains a safe alternative,
    // borrow one remaining slot from the preferred due/new/retained bucket.
    const bucket = quotaSafeBuckets[0]
      ?? allSafeBuckets[0]
      ?? orderedBuckets(preferred).find((candidate) => quotas[candidate] > 0 && pools[candidate].length > 0)
      ?? bucketOrder.find((candidate) => pools[candidate].length > 0);
    if (!bucket) break;

    const safePool = pools[bucket].filter((command) => outsideCooldown(command, recentWindow));
    const pool = safePool.length ? safePool : pools[bucket];
    // Prefer the most constrained remaining semantic group. This look-ahead
    // prevents a random draw from consuming all alternative families early and
    // creating an avoidable cooldown collision at the end of the shuffle bag.
    const pressure = Math.max(...pool.map((command) =>
      equivalencePressure(remainingEquivalence, command)));
    const constrainedPool = pool.filter((command) =>
      equivalencePressure(remainingEquivalence, command) === pressure);
    const pickedAt = pickWeightedIndex(constrainedPool, history, random, now, currentTopics);
    const picked = constrainedPool[pickedAt];
    if (!picked) break;
    queue.push(picked.id);
    recent.push(picked);
    if (quotas[bucket] > 0) {
      quotas[bucket] -= 1;
    } else {
      const donor = orderedBuckets(preferred).find((candidate) => quotas[candidate] > 0);
      if (donor) quotas[donor] -= 1;
    }
    const sourceAt = pools[bucket].findIndex((command) => command.id === picked.id);
    pools[bucket].splice(sourceAt, 1);
    incrementEquivalenceCounts(remainingEquivalence, picked, -1);
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

  const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_DAILY_RECALL_SIZE));
  const remaining = [...dueEntries];
  const ordered: string[] = [];
  const recent: Command[] = previous ? [previous] : [];
  while (ordered.length < limit && remaining.length) {
    const safeAt = remaining.findIndex(([id]) => {
      const command = catalogue.find((entry) => entry.id === id)!;
      return outsideCooldown(command, recentTail(recent));
    });
    const pickedAt = safeAt >= 0 ? safeAt : 0;
    const [[id]] = remaining.splice(pickedAt, 1);
    const picked = catalogue.find((command) => command.id === id)!;
    ordered.push(id);
    recent.push(picked);
  }
  return ordered;
};
