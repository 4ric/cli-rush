/**
 * Seeded coverage scheduler for one-action CLI navigation lessons.
 *
 * It plans over an explicit context graph and never changes simulated device
 * state itself. The shared command engine remains responsible for parsing and
 * executing the inert player input; this module only decides the next outcome.
 */

import type { DeviceProfileId } from "./device-profiles.ts";

export type NavigationContext =
  | "user"
  | "privileged"
  | "global"
  | "interface"
  | "subinterface"
  | "interface-range"
  | "vlan"
  | "line"
  | "router"
  | "dhcp"
  | "radius"
  | "aaa-group"
  | "acl-standard"
  | "acl-extended";

export type NavigationEvent =
  | { type: "command"; canonical: string }
  | { type: "control"; key: "Ctrl+A" | "Ctrl+C" | "Ctrl+E" | "Ctrl+U" | "Ctrl+W" | "Ctrl+Z" | "Ctrl+Shift+6" | "ArrowUp" | "ArrowDown" };

export interface NavigationObjective {
  id: string;
  conceptId: string;
  family: string;
  task: string;
  from: readonly NavigationContext[];
  to: NavigationContext | "same";
  event: NavigationEvent;
  profileIds: readonly DeviceProfileId[];
  graphEdge?: boolean;
  requiresHistory?: boolean;
  requiresRunningOperation?: boolean;
  createsRunningOperation?: boolean;
  clearsDraft?: boolean;
}

export interface PendingNavigationObjective {
  id: string;
  from: NavigationContext;
  countsTowardsCycle: boolean;
  forcedTransition: boolean;
}

export interface NavigationSchedulerState {
  version: 2;
  seed: number;
  profileId: DeviceProfileId;
  randomState: number;
  cycle: number;
  currentContext: NavigationContext;
  remainingIds: string[];
  recentTaskIds: string[];
  recentConceptIds: string[];
  recentFamilies: string[];
  recentTaskText: string[];
  historyAvailable: boolean;
  runningOperation: boolean;
  completed: number;
  pending: PendingNavigationObjective | null;
}

export interface ScheduledNavigationObjective {
  objective: NavigationObjective;
  state: NavigationSchedulerState;
  countsTowardsCycle: boolean;
  forcedTransition: boolean;
}

const configContexts: readonly NavigationContext[] = [
  "global",
  "interface",
  "subinterface",
  "interface-range",
  "vlan",
  "line",
  "router",
  "dhcp",
  "radius",
  "aaa-group",
  "acl-standard",
  "acl-extended",
];

const subcontexts = configContexts.filter((context) => context !== "global");

const objective = (
  id: string,
  conceptId: string,
  family: string,
  task: string,
  from: readonly NavigationContext[],
  to: NavigationObjective["to"],
  event: NavigationEvent,
  options: Partial<Pick<NavigationObjective,
    "graphEdge" | "requiresHistory" | "requiresRunningOperation" | "createsRunningOperation" | "clearsDraft" | "profileIds"
  >> = {},
): NavigationObjective => ({
  id,
  conceptId,
  family,
  task,
  from,
  to,
  event,
  profileIds: ["router-ios-xe", "catalyst-l2"],
  ...options,
});

const routerOnly = ["router-ios-xe"] as const;
const switchOnly = ["catalyst-l2"] as const;

export const navigationObjectives: readonly NavigationObjective[] = [
  objective("nav.enable", "privilege.enter", "enable", "Move to Privileged EXEC.", ["user"], "privileged", { type: "command", canonical: "enable" }, { graphEdge: true }),
  objective("nav.disable", "privilege.leave", "disable", "Return to User EXEC.", ["privileged"], "user", { type: "command", canonical: "disable" }, { graphEdge: true }),
  objective("nav.configure", "configuration.enter", "configure", "Enter Global Configuration.", ["privileged"], "global", { type: "command", canonical: "configure terminal" }, { graphEdge: true }),
  objective("nav.exit-global", "configuration.leave-one", "exit", "Leave Global Configuration.", ["global"], "privileged", { type: "command", canonical: "exit" }, { graphEdge: true }),
  objective("nav.interface", "interface.enter", "interface", "Open the named physical interface.", ["global"], "interface", { type: "command", canonical: "interface GigabitEthernet0/0/1" }, { graphEdge: true }),
  objective("nav.subinterface", "subinterface.enter", "interface", "Open the named router subinterface.", ["global"], "subinterface", { type: "command", canonical: "interface GigabitEthernet0/0/1.10" }, { graphEdge: true, profileIds: routerOnly }),
  objective("nav.interface-range", "interface-range.enter", "interface", "Open the stated access-port range.", ["global"], "interface-range", { type: "command", canonical: "interface range GigabitEthernet1/0/1 - 4" }, { graphEdge: true, profileIds: switchOnly }),
  objective("nav.vlan", "vlan.enter", "vlan", "Open configuration for VLAN 10.", ["global"], "vlan", { type: "command", canonical: "vlan 10" }, { graphEdge: true, profileIds: switchOnly }),
  objective("nav.line", "line.enter", "line", "Open the VTY line range.", ["global"], "line", { type: "command", canonical: "line vty 0 4" }, { graphEdge: true }),
  objective("nav.router", "router.enter", "router", "Open OSPF process 10.", ["global"], "router", { type: "command", canonical: "router ospf 10" }, { graphEdge: true, profileIds: routerOnly }),
  objective("nav.dhcp", "dhcp.enter", "ip-dhcp", "Open the USERS DHCP pool.", ["global"], "dhcp", { type: "command", canonical: "ip dhcp pool USERS" }, { graphEdge: true, profileIds: routerOnly }),
  objective("nav.radius", "radius.enter", "radius", "Open the named RADIUS server.", ["global"], "radius", { type: "command", canonical: "radius server RAD1" }, { graphEdge: true }),
  objective("nav.aaa-group", "aaa-group.enter", "aaa-group", "Open the RADIUS server group.", ["global"], "aaa-group", { type: "command", canonical: "aaa group server radius RAD-GRP" }, { graphEdge: true }),
  objective("nav.acl-standard", "acl-standard.enter", "ip-access-list", "Open the named standard IPv4 ACL.", ["global"], "acl-standard", { type: "command", canonical: "ip access-list standard MGMT" }, { graphEdge: true }),
  objective("nav.acl-extended", "acl-extended.enter", "ip-access-list", "Open the named extended IPv4 ACL.", ["global"], "acl-extended", { type: "command", canonical: "ip access-list extended WEB-IN" }, { graphEdge: true }),
  ...subcontexts.map((context) => objective(
    `nav.exit-${context}`,
    `${context}.leave-one`,
    "exit",
    `Leave ${context.replaceAll("-", " ")} configuration by one level.`,
    [context],
    "global",
    { type: "command", canonical: "exit" },
    {
      graphEdge: true,
      profileIds: context === "subinterface" || context === "router" || context === "dhcp"
        ? routerOnly
        : context === "interface-range" || context === "vlan"
          ? switchOnly
          : ["router-ios-xe", "catalyst-l2"],
    },
  )),
  objective("nav.end", "configuration.end", "end", "Return directly to Privileged EXEC.", subcontexts, "privileged", { type: "command", canonical: "end" }, { graphEdge: true }),
  objective("nav.ctrl-z", "configuration.ctrl-z", "control-navigation", "Return to Privileged EXEC with Ctrl+Z.", configContexts, "privileged", { type: "control", key: "Ctrl+Z" }, { graphEdge: true }),
  objective("nav.do-show", "configuration.do-inspect", "do", "Inspect interface state without leaving configuration.", configContexts, "same", { type: "command", canonical: "do show ip interface brief" }),
  objective("edit.history-up", "editing.history-up", "history", "Recall the previous command.", ["user", "privileged", ...configContexts], "same", { type: "control", key: "ArrowUp" }, { requiresHistory: true }),
  objective("edit.history-down", "editing.history-down", "history", "Move forwards through command history.", ["user", "privileged", ...configContexts], "same", { type: "control", key: "ArrowDown" }, { requiresHistory: true }),
  objective("edit.clear-line", "editing.clear-line", "line-editing", "Clear the current draft command.", ["user", "privileged", ...configContexts], "same", { type: "control", key: "Ctrl+U" }, { clearsDraft: true }),
  objective("edit.line-start", "editing.line-start", "line-editing", "Move the caret to the start of the line.", ["user", "privileged", ...configContexts], "same", { type: "control", key: "Ctrl+A" }),
  objective("edit.line-end", "editing.line-end", "line-editing", "Move the caret to the end of the line.", ["user", "privileged", ...configContexts], "same", { type: "control", key: "Ctrl+E" }),
  objective("edit.delete-word", "editing.delete-word", "line-editing", "Delete the word before the caret.", ["user", "privileged", ...configContexts], "same", { type: "control", key: "Ctrl+W" }),
  objective("edit.cancel", "editing.cancel", "control-navigation", "Cancel the unfinished line safely.", ["user", "privileged"], "same", { type: "control", key: "Ctrl+C" }, { clearsDraft: true }),
  objective("tools.start-ping", "connectivity.interrupt.start", "ping", "Start the extended simulated reachability test.", ["privileged"], "same", { type: "command", canonical: "ping 198.51.100.10" }, { createsRunningOperation: true }),
  objective("tools.interrupt", "connectivity.interrupt", "control-navigation", "Interrupt the running reachability test.", ["privileged"], "same", { type: "control", key: "Ctrl+Shift+6" }, { requiresRunningOperation: true }),
  objective("session.logout", "session.logout", "logout", "Close and recover the learning session.", ["user"], "user", { type: "command", canonical: "logout" }),
];

const contextSet = new Set<NavigationContext>([
  "user", "privileged", "global", "interface", "subinterface", "interface-range",
  "vlan", "line", "router", "dhcp", "radius", "aaa-group", "acl-standard", "acl-extended",
]);

export const navigationObjectivesForProfile = (
  profileId: DeviceProfileId,
  objectives: readonly NavigationObjective[] = navigationObjectives,
): NavigationObjective[] => objectives.filter((item) => item.profileIds.includes(profileId));

const normaliseSeed = (seed: number): number =>
  (Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1) || 1;

const nextRandom = (value: number): number => {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0 || 1;
};

const shuffledIds = (
  objectives: readonly NavigationObjective[],
  seed: number,
): { ids: string[]; randomState: number } => {
  const ids = objectives.map((item) => item.id);
  let randomState = seed;
  for (let index = ids.length - 1; index > 0; index -= 1) {
    randomState = nextRandom(randomState);
    const swapAt = randomState % (index + 1);
    [ids[index], ids[swapAt]] = [ids[swapAt], ids[index]];
  }
  return { ids, randomState };
};

const cloneState = (state: NavigationSchedulerState): NavigationSchedulerState => ({
  ...state,
  remainingIds: [...state.remainingIds],
  recentTaskIds: [...state.recentTaskIds],
  recentConceptIds: [...state.recentConceptIds],
  recentFamilies: [...state.recentFamilies],
  recentTaskText: [...state.recentTaskText],
  pending: state.pending ? { ...state.pending } : null,
});

export const createNavigationScheduler = (
  seed = 1,
  profileId: DeviceProfileId = "router-ios-xe",
  objectives: readonly NavigationObjective[] = navigationObjectives,
): NavigationSchedulerState => {
  const stableSeed = normaliseSeed(seed);
  const scope = navigationObjectivesForProfile(profileId, objectives);
  const bag = shuffledIds(scope, stableSeed);
  return {
    version: 2,
    seed: stableSeed,
    profileId,
    randomState: bag.randomState,
    cycle: 0,
    currentContext: "user",
    remainingIds: bag.ids,
    recentTaskIds: [],
    recentConceptIds: [],
    recentFamilies: [],
    recentTaskText: [],
    historyAvailable: false,
    runningOperation: false,
    completed: 0,
    pending: null,
  };
};

const normalisedTaskText = (value: string): string =>
  value.trim().toLocaleLowerCase("en-GB").replace(/\s+/gu, " ");

const prerequisiteReady = (
  item: NavigationObjective,
  state: NavigationSchedulerState,
): boolean => (!item.requiresHistory || state.historyAvailable)
  && (!item.requiresRunningOperation || state.runningOperation);

const availableHere = (
  item: NavigationObjective,
  state: NavigationSchedulerState,
): boolean => item.from.includes(state.currentContext) && prerequisiteReady(item, state);

const inCooldown = (item: NavigationObjective, state: NavigationSchedulerState): boolean =>
  state.recentTaskIds.includes(item.id)
  || state.recentConceptIds.includes(item.conceptId)
  || state.recentFamilies.includes(item.family)
  || state.recentTaskText.includes(normalisedTaskText(item.task));

const byId = (objectives: readonly NavigationObjective[]): Map<string, NavigationObjective> =>
  new Map(objectives.map((item) => [item.id, item]));

const nextContext = (
  current: NavigationContext,
  item: NavigationObjective,
): NavigationContext => item.to === "same" ? current : item.to;

const shortestFirstEdge = (
  state: NavigationSchedulerState,
  target: NavigationObjective,
  objectives: readonly NavigationObjective[],
): NavigationObjective | null => {
  if (target.from.includes(state.currentContext)) return target;
  const edges = objectives.filter((item) => item.graphEdge && prerequisiteReady(item, state));
  const queue: Array<{ context: NavigationContext; first: NavigationObjective | null }> = [
    { context: state.currentContext, first: null },
  ];
  const visited = new Set<NavigationContext>([state.currentContext]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges.filter((item) => item.from.includes(current.context))) {
      const destination = nextContext(current.context, edge);
      const first = current.first ?? edge;
      if (target.from.includes(destination)) return first;
      if (!visited.has(destination)) {
        visited.add(destination);
        queue.push({ context: destination, first });
      }
    }
  }
  return null;
};

const startNextCycle = (
  state: NavigationSchedulerState,
  objectives: readonly NavigationObjective[],
): void => {
  const bag = shuffledIds(
    navigationObjectivesForProfile(state.profileId, objectives),
    nextRandom(state.randomState),
  );
  state.remainingIds = bag.ids;
  state.randomState = bag.randomState;
  state.cycle += 1;
};

const chooseNext = (
  state: NavigationSchedulerState,
  objectives: readonly NavigationObjective[],
): { item: NavigationObjective; countsTowardsCycle: boolean; forcedTransition: boolean } => {
  const index = byId(objectives);
  const remaining = state.remainingIds.map((id) => index.get(id)).filter((item): item is NavigationObjective => Boolean(item));
  const eligible = remaining.filter((item) => availableHere(item, state));
  const cooled = eligible.filter((item) => !inCooldown(item, state));
  if (cooled.length) return { item: cooled[0], countsTowardsCycle: true, forcedTransition: false };
  if (eligible.length) return { item: eligible[0], countsTowardsCycle: true, forcedTransition: true };

  // If an editing prerequisite is outstanding, deliberately create it instead
  // of silently seeding hidden state.
  const prerequisiteProducer = !state.runningOperation
    && remaining.some((item) => item.requiresRunningOperation)
    ? index.get("tools.start-ping")
    : null;
  const targets = prerequisiteProducer ? [prerequisiteProducer, ...remaining] : remaining;
  for (const target of targets) {
    if (!target || (!prerequisiteReady(target, state) && !target.createsRunningOperation)) continue;
    const edge = shortestFirstEdge(state, target, objectives);
    if (!edge) continue;
    const countsTowardsCycle = state.remainingIds.includes(edge.id);
    return {
      item: edge,
      countsTowardsCycle,
      forcedTransition: true,
    };
  }

  // The graph is deliberately connected. This guard turns a future malformed
  // scope into a specific failure rather than an endless navigation loop.
  throw new Error(`Navigation scope has no path from ${state.currentContext}.`);
};

export const scheduleNavigationObjective = (
  current: NavigationSchedulerState,
  objectives: readonly NavigationObjective[] = navigationObjectives,
): ScheduledNavigationObjective => {
  const state = cloneState(current);
  const scope = navigationObjectivesForProfile(state.profileId, objectives);
  const index = byId(scope);
  if (state.pending) {
    const pending = index.get(state.pending.id);
    if (!pending) throw new Error(`Unknown pending navigation objective ${state.pending.id}.`);
    return {
      objective: pending,
      state,
      countsTowardsCycle: state.pending.countsTowardsCycle,
      forcedTransition: state.pending.forcedTransition,
    };
  }
  if (!state.remainingIds.length) startNextCycle(state, scope);
  const selection = chooseNext(state, scope);
  state.pending = {
    id: selection.item.id,
    from: state.currentContext,
    countsTowardsCycle: selection.countsTowardsCycle,
    forcedTransition: selection.forcedTransition,
  };
  return { objective: selection.item, state, ...selection };
};

const appendBounded = (values: string[], value: string, limit = 8): string[] =>
  [...values, value].slice(-limit);

export const completeNavigationObjective = (
  current: NavigationSchedulerState,
  objectiveId: string,
  objectives: readonly NavigationObjective[] = navigationObjectives,
): NavigationSchedulerState => {
  const state = cloneState(current);
  const scope = navigationObjectivesForProfile(state.profileId, objectives);
  const item = byId(scope).get(objectiveId);
  if (!item || !state.pending || state.pending.id !== objectiveId) {
    throw new Error("The completed navigation objective does not match the persisted pending task.");
  }
  if (state.pending.from !== state.currentContext || !item.from.includes(state.currentContext)) {
    throw new Error("The pending navigation objective is not valid from the persisted CLI context.");
  }

  state.currentContext = nextContext(state.currentContext, item);
  if (state.pending.countsTowardsCycle) {
    state.remainingIds = state.remainingIds.filter((id) => id !== item.id);
  }
  state.recentTaskIds = appendBounded(state.recentTaskIds, item.id);
  state.recentConceptIds = appendBounded(state.recentConceptIds, item.conceptId);
  state.recentFamilies = appendBounded(state.recentFamilies, item.family);
  state.recentTaskText = appendBounded(state.recentTaskText, normalisedTaskText(item.task));
  if (item.event.type === "command") state.historyAvailable = true;
  if (item.createsRunningOperation) state.runningOperation = true;
  if (item.requiresRunningOperation) state.runningOperation = false;
  state.completed += 1;
  state.pending = null;
  return state;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const restoreNavigationScheduler = (
  value: unknown,
  objectives: readonly NavigationObjective[] = navigationObjectives,
): NavigationSchedulerState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const migrated = raw.version === 1
    ? (() => {
        const profileId: DeviceProfileId = "router-ios-xe";
        const scopeIds = new Set(navigationObjectivesForProfile(profileId, objectives).map((item) => item.id));
        const oldContext = raw.currentContext === "radius-group" ? "aaa-group" : raw.currentContext;
        const currentContext = oldContext === "interface-range" || oldContext === "vlan" ? "user" : oldContext;
        const oldPending = raw.pending && typeof raw.pending === "object" && !Array.isArray(raw.pending)
          ? raw.pending as Record<string, unknown>
          : null;
        const pending = oldPending && scopeIds.has(String(oldPending.id)) && oldPending.from === currentContext
          ? { ...oldPending, from: currentContext }
          : null;
        return {
          ...raw,
          version: 2,
          profileId,
          currentContext,
          remainingIds: Array.isArray(raw.remainingIds)
            ? raw.remainingIds.filter((id): id is string => typeof id === "string" && scopeIds.has(id))
            : raw.remainingIds,
          pending,
        };
      })()
    : raw;
  const saved = migrated as Partial<NavigationSchedulerState>;
  if (saved.profileId !== "router-ios-xe" && saved.profileId !== "catalyst-l2") return null;
  const scope = navigationObjectivesForProfile(saved.profileId, objectives);
  const ids = new Set(scope.map((item) => item.id));
  if (saved.version !== 2
    || typeof saved.seed !== "number"
    || typeof saved.randomState !== "number"
    || !Number.isInteger(saved.cycle) || (saved.cycle ?? -1) < 0
    || !contextSet.has(saved.currentContext as NavigationContext)
    || !isStringArray(saved.remainingIds) || saved.remainingIds.some((id) => !ids.has(id))
    || new Set(saved.remainingIds).size !== saved.remainingIds.length
    || !isStringArray(saved.recentTaskIds)
    || !isStringArray(saved.recentConceptIds)
    || !isStringArray(saved.recentFamilies)
    || !isStringArray(saved.recentTaskText)
    || saved.recentTaskIds.length > 8
    || saved.recentConceptIds.length > 8
    || saved.recentFamilies.length > 8
    || saved.recentTaskText.length > 8
    || typeof saved.historyAvailable !== "boolean"
    || typeof saved.runningOperation !== "boolean"
    || !Number.isInteger(saved.completed) || (saved.completed ?? -1) < 0) return null;

  let pending: PendingNavigationObjective | null = null;
  if (saved.pending !== null) {
    if (!saved.pending || typeof saved.pending !== "object"
      || !ids.has(saved.pending.id)
      || !contextSet.has(saved.pending.from)
      || typeof saved.pending.countsTowardsCycle !== "boolean"
      || typeof saved.pending.forcedTransition !== "boolean"
      || saved.pending.from !== saved.currentContext) return null;
    pending = { ...saved.pending };
  }
  return {
    version: 2,
    seed: normaliseSeed(saved.seed),
    profileId: saved.profileId,
    randomState: normaliseSeed(saved.randomState),
    cycle: saved.cycle!,
    currentContext: saved.currentContext as NavigationContext,
    remainingIds: [...saved.remainingIds],
    recentTaskIds: [...saved.recentTaskIds],
    recentConceptIds: [...saved.recentConceptIds],
    recentFamilies: [...saved.recentFamilies],
    recentTaskText: [...saved.recentTaskText],
    historyAvailable: saved.historyAvailable,
    runningOperation: saved.runningOperation,
    completed: saved.completed!,
    pending,
  };
};
