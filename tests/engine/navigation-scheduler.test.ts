import assert from "node:assert/strict";
import test from "node:test";
import {
  completeNavigationObjective,
  createNavigationScheduler,
  navigationObjectives,
  navigationObjectivesForProfile,
  restoreNavigationScheduler,
  scheduleNavigationObjective,
} from "../../lib/navigation-scheduler.ts";
import { executeCliCommand, handleCliControl, initialDevice, type CliControlKey } from "../../lib/engine.ts";
import type { DeviceProfileId } from "../../lib/device-profiles.ts";

const runOne = (seed: number, count: number, profileId: DeviceProfileId = "router-ios-xe") => {
  let state = createNavigationScheduler(seed, profileId);
  const plans = [];
  for (let index = 0; index < count; index += 1) {
    const plan = scheduleNavigationObjective(state);
    plans.push(plan);
    state = completeNavigationObjective(plan.state, plan.objective.id);
  }
  return { state, plans };
};

test("a pending objective survives refresh and cannot be replaced", () => {
  const first = scheduleNavigationObjective(createNavigationScheduler(42));
  const restored = restoreNavigationScheduler(JSON.parse(JSON.stringify(first.state)));
  assert.ok(restored);
  const again = scheduleNavigationObjective(restored);
  assert.equal(again.objective.id, first.objective.id);
  assert.deepEqual(again.state, first.state);
  assert.throws(
    () => completeNavigationObjective(first.state, navigationObjectives.find((item) => item.id !== first.objective.id)!.id),
    /does not match/u,
  );
});

test("100 deterministic seeds produce 100 valid one-action objectives without a dead end", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const { state, plans } = runOne(seed, 100);
    assert.equal(state.completed, 100, `seed ${seed}`);
    assert.equal(plans.length, 100, `seed ${seed}`);
    assert.ok(plans.every((plan) => plan.objective.from.includes(plan.state.pending!.from)), `seed ${seed}`);
  }
});

test("every objective is covered before a new coverage cycle begins", () => {
  for (const profileId of ["router-ios-xe", "catalyst-l2"] as const) {
    const scope = navigationObjectivesForProfile(profileId);
    for (const seed of [1, 2, 9, 77, 0xdeadbeef]) {
      let state = createNavigationScheduler(seed, profileId);
      const covered = new Set<string>();
      let guard = 0;
      while (state.cycle === 0 || state.pending) {
        const plan = scheduleNavigationObjective(state);
        if (plan.countsTowardsCycle) covered.add(plan.objective.id);
        state = completeNavigationObjective(plan.state, plan.objective.id);
        guard += 1;
        assert.ok(guard < 500, `${profileId} seed ${seed} did not finish a coverage cycle`);
        if (state.remainingIds.length === 0) break;
      }
      assert.equal(covered.size, scope.length, `${profileId} seed ${seed}`);
      assert.deepEqual(
        [...covered].sort(),
        scope.map((item) => item.id).sort(),
        `${profileId} seed ${seed}`,
      );
    }
  }
});

test("scheduled objectives execute on the fixed device profile that advertised them", () => {
  for (const profileId of ["router-ios-xe", "catalyst-l2"] as const) {
    let scheduler = createNavigationScheduler(20260713, profileId);
    let device = initialDevice(profileId);
    const history: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const plan = scheduleNavigationObjective(scheduler);
      assert.equal(plan.state.currentContext, device.context, `${profileId}: ${plan.objective.id}`);
      if (plan.objective.event.type === "command") {
        const execution = executeCliCommand(device, plan.objective.event.canonical);
        assert.equal(execution.accepted, true, `${profileId}: ${plan.objective.event.canonical}`);
        device = execution.state;
        history.push(plan.objective.event.canonical);
      } else {
        const draft = plan.objective.event.key === "Ctrl+Z" ? "" : "show ip route";
        const result = handleCliControl(device, plan.objective.event.key as CliControlKey, draft, history, history.length);
        device = result.state;
      }
      scheduler = completeNavigationObjective(plan.state, plan.objective.id);
      assert.equal(scheduler.currentContext, device.context, `${profileId}: ${plan.objective.id}`);
    }
  }
});

test("cooldown covers task, concept, family and normalised wording unless a transition is forced", () => {
  const { plans } = runOne(20260713, 180);
  for (let index = 0; index < plans.length; index += 1) {
    const current = plans[index];
    const previous = plans.slice(Math.max(0, index - 8), index);
    const collision = previous.some((plan) =>
      plan.objective.id === current.objective.id
      || plan.objective.conceptId === current.objective.conceptId
      || plan.objective.family === current.objective.family
      || plan.objective.task.trim().toLowerCase() === current.objective.task.trim().toLowerCase());
    if (collision) assert.equal(current.forcedTransition, true, `${index}: ${current.objective.id}`);
  }
});

test("history and interrupt objectives are scheduled only after their visible prerequisites", () => {
  const { plans } = runOne(13, 160);
  let historyAvailable = false;
  let running = false;
  let sawHistory = false;
  let sawInterrupt = false;
  for (const plan of plans) {
    if (plan.objective.requiresHistory) {
      assert.equal(historyAvailable, true);
      sawHistory = true;
    }
    if (plan.objective.requiresRunningOperation) {
      assert.equal(running, true);
      running = false;
      sawInterrupt = true;
    }
    if (plan.objective.event.type === "command") historyAvailable = true;
    if (plan.objective.createsRunningOperation) running = true;
  }
  assert.equal(sawHistory, true);
  assert.equal(sawInterrupt, true);
});

test("tampered or future scheduler state is rejected", () => {
  const valid = scheduleNavigationObjective(createNavigationScheduler(5)).state;
  assert.ok(restoreNavigationScheduler(valid));
  assert.equal(restoreNavigationScheduler({ ...valid, version: 3 }), null);
  assert.equal(restoreNavigationScheduler({ ...valid, currentContext: "shell" }), null);
  assert.equal(restoreNavigationScheduler({ ...valid, remainingIds: ["not-real"] }), null);
  assert.equal(restoreNavigationScheduler({ ...valid, completed: -1 }), null);

  const legacy = { ...valid, version: 1 } as Record<string, unknown>;
  delete legacy.profileId;
  const migrated = restoreNavigationScheduler(legacy);
  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.profileId, "router-ios-xe");
});
