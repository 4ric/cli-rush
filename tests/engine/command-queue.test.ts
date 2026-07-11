import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdaptiveCommandSession,
  buildDailyRecallSession,
  commandQueueBucket,
  commandQueueWeight,
  protocolFocusWeight,
  weightedCommandQueue,
} from "../../lib/command-queue.ts";
import type { CommandRecallHistory } from "../../lib/command-queue.ts";
import type { Command } from "../../lib/engine.ts";
import type { Review } from "../../lib/scheduler.ts";

const now = Date.parse("2026-07-11T12:00:00Z");

const command = (id: string, canonical: string, objective = id, topic = "Test"): Command => ({
  id,
  canonical,
  objective,
  mode: "privileged",
  explanation: "Test explanation.",
  topic,
  kind: "verification",
  difficulty: 1,
});

const review = (overrides: Partial<Review> = {}): Review => ({
  stage: 1,
  dueAt: now + 86_400_000,
  lastAt: now - 1_000,
  lapses: 0,
  bestStage: 1,
  outcome: "firstTry",
  cleanRecalls: 2,
  ...overrides,
});

const ipv4 = command("ipv4", "show ip route", "Display the IPv4 routing table.");
const ipv6 = command("ipv6", "show ipv6 route", "Display the IPv6 routing table.");
const neutral = command("neutral", "show version", "Display platform information.");

test("protocol weighting favours IPv4 and retains lower-frequency IPv6", () => {
  assert.equal(protocolFocusWeight(ipv4), 2);
  assert.equal(protocolFocusWeight(ipv6), 0.35);
  assert.equal(protocolFocusWeight(neutral), 1);
});

test("correct totals do not monotonically increase revisit weight", () => {
  const base = commandQueueWeight(neutral, undefined, now);
  const correctOnly = commandQueueWeight(neutral, { correct: 8 }, now);
  const retained = commandQueueWeight(
    neutral,
    { attempts: 8, correct: 8, firstTry: 8, review: review({ cleanRecalls: 8 }) },
    now,
  );
  assert.equal(correctOnly, base);
  assert.ok(retained < base);
});

test("due, failed, assisted, revealed and slow material is prioritised", () => {
  const cases = [
    { attempts: 1, firstTry: 1, review: review({ dueAt: now }) },
    { attempts: 2, firstTry: 0, lastError: "WRONG_MODE", review: review({ outcome: "failed" }) },
    { attempts: 1, assisted: 1 },
    { attempts: 1, revealed: 1 },
    { attempts: 1, firstTry: 1, averageResponseMs: 12_000 },
  ];
  for (const history of cases) {
    assert.equal(commandQueueBucket(history, now), "priority");
    assert.ok(commandQueueWeight(neutral, history, now) > 1);
  }
  assert.equal(commandQueueBucket(undefined, now), "new");
  assert.equal(commandQueueBucket({ attempts: 2, firstTry: 2, review: review() }, now), "retained");
});

test("adaptive sessions use a bounded 60/20/20 mix when all pools are available", () => {
  const catalogue: Command[] = [];
  const history: Record<string, CommandRecallHistory> = {};
  for (let index = 0; index < 20; index += 1) {
    const priority = command(`priority-${index}`, `show priority ${index}`);
    const unseen = command(`new-${index}`, `show new ${index}`);
    const retained = command(`retained-${index}`, `show retained ${index}`);
    catalogue.push(priority, unseen, retained);
    history[priority.id] = {
      attempts: 2,
      firstTry: 1,
      review: review({ dueAt: now - index - 1 }),
    };
    history[retained.id] = {
      attempts: 2,
      firstTry: 2,
      review: review(),
    };
  }

  const session = buildAdaptiveCommandSession(catalogue, history, {
    now,
    limit: 20,
    random: () => 0.25,
  });
  assert.equal(session.length, 20);
  assert.equal(new Set(session).size, 20);
  assert.equal(session.filter((id) => id.startsWith("priority-")).length, 12);
  assert.equal(session.filter((id) => id.startsWith("new-")).length, 4);
  assert.equal(session.filter((id) => id.startsWith("retained-")).length, 4);
});

test("a new queue never repeats the previous opening command or canonical form", () => {
  const duplicate = command("ipv4.other-mode", "show ip route", "Same command in another context.");
  const catalogue = [ipv4, duplicate, ipv6, neutral];
  for (const random of [() => 0, () => 0.5, () => 0.999999]) {
    const queue = weightedCommandQueue(catalogue, {}, "ipv4", random, { now });
    assert.notEqual(queue[0], "ipv4");
    assert.notEqual(queue[0], "ipv4.other-mode");
    assert.equal(new Set(queue).size, catalogue.length);
    assert.deepEqual([...queue].sort(), catalogue.map((entry) => entry.id).sort());
  }
});

test("Daily Recall is bounded, due-only and ordered by overdue time", () => {
  const catalogue = [command("old", "show old"), command("recent", "show recent"), neutral];
  const history = {
    old: { review: review({ dueAt: now - 5_000, lapses: 1 }) },
    recent: { review: review({ dueAt: now - 1_000, lapses: 8 }) },
    neutral: { review: review({ dueAt: now + 1_000 }) },
  };
  assert.deepEqual(
    buildDailyRecallSession(catalogue, history, { now, limit: 1 }),
    ["old"],
  );
  assert.deepEqual(
    buildDailyRecallSession(catalogue, history, { now, limit: 10 }),
    ["old", "recent"],
  );
  assert.deepEqual(
    buildDailyRecallSession(catalogue, history, {
      now,
      limit: 10,
      previousFirstId: "old",
    }),
    ["recent", "old"],
  );
});

test("weighted random draws favour IPv4 across repeated session openers", () => {
  let state = 0x12345678;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const counts = { ipv4: 0, ipv6: 0, neutral: 0 };
  for (let run = 0; run < 2_000; run += 1) {
    const first = weightedCommandQueue([ipv4, ipv6, neutral], {}, null, random, { now })[0];
    counts[first as keyof typeof counts] += 1;
  }
  assert.ok(counts.ipv4 > counts.neutral, JSON.stringify(counts));
  assert.ok(counts.neutral > counts.ipv6, JSON.stringify(counts));
});
