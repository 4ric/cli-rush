import assert from "node:assert/strict";
import test from "node:test";
import {
  commandQueueWeight,
  protocolFocusWeight,
  weightedCommandQueue,
} from "../../lib/command-queue.ts";
import type { Command } from "../../lib/engine.ts";

const command = (id: string, canonical: string, objective = id): Command => ({
  id,
  canonical,
  objective,
  mode: "privileged",
  explanation: "Test explanation.",
  topic: "Test",
  kind: "verification",
  difficulty: 1,
});

const ipv4 = command("ipv4", "show ip route", "Display the IPv4 routing table.");
const ipv6 = command("ipv6", "show ipv6 route", "Display the IPv6 routing table.");
const neutral = command("neutral", "show version", "Display platform information.");

test("protocol weighting favours IPv4 and retains lower-frequency IPv6", () => {
  assert.equal(protocolFocusWeight(ipv4), 2);
  assert.equal(protocolFocusWeight(ipv6), 0.35);
  assert.equal(protocolFocusWeight(neutral), 1);
});

test("correct, assisted and revealed history all increase revisit weight", () => {
  const base = commandQueueWeight(neutral, undefined);
  const correct = commandQueueWeight(neutral, { correct: 4 });
  const assisted = commandQueueWeight(neutral, { assisted: 2 });
  const revealed = commandQueueWeight(neutral, { revealed: 2 });
  assert.ok(correct > base);
  assert.ok(assisted > correct);
  assert.ok(revealed > assisted);
});

test("a new queue never repeats the previous opening command", () => {
  const duplicate = command("ipv4.other-mode", "show ip route", "Same canonical command in another context.");
  const catalogue = [ipv4, duplicate, ipv6, neutral];
  for (const random of [() => 0, () => 0.5, () => 0.999999]) {
    const queue = weightedCommandQueue(catalogue, {}, "ipv4", random);
    assert.notEqual(queue[0], "ipv4");
    assert.notEqual(queue[0], "ipv4.other-mode");
    assert.equal(new Set(queue).size, catalogue.length);
    assert.deepEqual([...queue].sort(), catalogue.map((entry) => entry.id).sort());
  }
});

test("weighted random draws favour IPv4 across repeated session openers", () => {
  let state = 0x12345678;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const counts = { ipv4: 0, ipv6: 0, neutral: 0 };
  for (let run = 0; run < 2_000; run += 1) {
    const first = weightedCommandQueue([ipv4, ipv6, neutral], {}, null, random)[0];
    counts[first as keyof typeof counts] += 1;
  }
  assert.ok(counts.ipv4 > counts.neutral, JSON.stringify(counts));
  assert.ok(counts.neutral > counts.ipv6, JSON.stringify(counts));
});
