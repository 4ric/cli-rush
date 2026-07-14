import assert from "node:assert/strict";
import test from "node:test";
import {
  commitAuthoritativeCustomCommandRecords,
  createAdvancedCustomCommand,
  createBasicCustomCommand,
  customCommandLimits,
  customCommandsForProfile,
  migrateLegacyCustomCommands,
  reconcileCustomCommandStores,
  toRegistryCommand,
  validateCustomCommand,
  type AdvancedCustomCommandInput,
  type CustomCommandDraft,
  type CustomCommandRecord,
} from "../../lib/custom-commands.ts";
import { buildCommandRegistry, parseRegistryInput } from "../../lib/command-registry.ts";
import { getDeviceProfile, type DeviceProfileId } from "../../lib/device-profiles.ts";
import { commands, type CliMode, type Command, type CommandKind } from "../../lib/engine.ts";

const advanced = (
  canonical: string,
  deviceProfile: DeviceProfileId = "router-ios-xe",
  context: CliMode = "global",
  kind: CommandKind = "configuration",
  overrides: Partial<AdvancedCustomCommandInput> = {},
): CustomCommandDraft => createAdvancedCustomCommand({
  deviceProfile,
  context,
  canonical,
  task: `Apply ${canonical} for the stated lab outcome.`,
  explanation: "This fictional lab command demonstrates the requested deterministic result.",
  kind,
  difficulty: 2,
  helpDescription: "Apply the bounded lab command.",
  effect: { type: "state-change", description: "Updates only the described fictional lab state." },
  why: "The change supports the stated lab outcome.",
  progressiveHints: ["Identify the feature family.", "Choose the action keyword.", "Add the supplied lab value."],
  revealExplanation: "The command changes only the fictional lab state described above.",
  verification: "Use the related show command and confirm the described state.",
  undo: "Use the matching no form where the bounded simulator supports it.",
  tags: ["custom", "lab"],
  prerequisites: [],
  ...overrides,
});

const issueCodes = (result: ReturnType<typeof validateCustomCommand>): string[] =>
  result.ok ? [] : result.errors.map((entry) => entry.code);

test("basic authoring infers only conservative read-only semantics and deterministic defaults", () => {
  const cases: Array<{
    canonical: string;
    context: CliMode;
    profile: DeviceProfileId;
  }> = [
    { canonical: "show parser statistics", context: "privileged", profile: "router-ios-xe" },
    { canonical: "ping 192.0.2.1", context: "user", profile: "router-ios-xe" },
    { canonical: "traceroute 198.51.100.10", context: "user", profile: "catalyst-l2" },
  ];

  for (const item of cases) {
    const input = {
      deviceProfile: item.profile,
      context: item.context,
      canonical: item.canonical,
      task: "Return the requested operational evidence.",
      explanation: "The output supplies evidence without changing configuration.",
    } as const;
    const first = createBasicCustomCommand(input);
    const second = createBasicCustomCommand(input);
    assert.equal(first.id, second.id, item.canonical);
    assert.deepEqual(first.semantics.effect, {
      type: "read-only",
      result: "The output supplies evidence without changing configuration.",
    });
    assert.equal(first.kind, "verification");
    assert.equal(first.difficulty, 1);
    assert.equal(first.semantics.progressiveHints.length, 3);
    const validated = validateCustomCommand(first);
    assert.equal(validated.ok, true, `${item.canonical}: ${JSON.stringify(issueCodes(validated))}`);
  }

  const mutating = createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "global",
    canonical: "hostname Training-R2",
    task: "Set the fictional lab hostname.",
    explanation: "Changes the prompt name.",
  });
  assert.equal(mutating.semantics.effect, null);
  const rejected = validateCustomCommand(mutating);
  assert.equal(rejected.ok, false);
  assert.ok(issueCodes(rejected).includes("INVALID_EFFECT"));
});

test("advanced authoring preserves complete semantic teaching and recovery metadata", () => {
  const draft = advanced("logging discriminator LAB msg-body includes TEST", "router-ios-xe", "global", "configuration", {
    topic: "Monitoring services",
    difficulty: 3,
    helpDescription: "Create a fictional logging discriminator.",
    effect: { type: "state-change", description: "Adds the LAB discriminator to simulated running state." },
    why: "Filtering lab messages makes the verification outcome easier to inspect.",
    progressiveHints: ["Work in global configuration.", "Start with logging discriminator.", "Supply the fictional name and match text."],
    revealExplanation: "This creates only a bounded, fictional logging discriminator.",
    verification: "Inspect the simulated logging configuration.",
    undo: "Use no logging discriminator LAB.",
    tags: ["logging", "operations"],
    prerequisites: ["show.logging"],
  });
  const result = validateCustomCommand(draft);
  assert.equal(result.ok, true, JSON.stringify(issueCodes(result)));
  if (!result.ok) return;
  assert.equal(result.active.status, "active");
  assert.equal(result.active.semantics.effect.type, "state-change");
  assert.equal(result.active.semantics.verification, "Inspect the simulated logging configuration.");
  assert.equal(result.active.semantics.undo, "Use no logging discriminator LAB.");
  assert.deepEqual(result.active.semantics.tags, ["logging", "operations"]);
  assert.deepEqual(result.active.semantics.prerequisites, ["show.logging"]);
  assert.equal(result.command.custom, true);
  assert.equal(result.command.canonical, draft.canonical);
});

test("state-effect rules remain explicit and actionable", () => {
  const cases: Array<{ draft: CustomCommandDraft; code: string }> = [
    {
      draft: advanced("service sequence-numbers", "router-ios-xe", "global", "configuration", { verification: undefined }),
      code: "REQUIRED",
    },
    {
      draft: advanced("show parser custom", "router-ios-xe", "privileged", "configuration", {
        effect: { type: "read-only", result: "Returns bounded parser output." },
      }),
      code: "KIND_EFFECT_MISMATCH",
    },
  ];
  for (const item of cases) {
    const result = validateCustomCommand(item.draft);
    assert.equal(result.ok, false);
    assert.ok(issueCodes(result).includes(item.code), `${item.draft.canonical}: ${JSON.stringify(issueCodes(result))}`);
  }

  const withoutUndo = advanced("service sequence-numbers", "router-ios-xe", "global", "configuration", { undo: undefined });
  const result = validateCustomCommand(withoutUndo);
  assert.equal(result.ok, true, JSON.stringify(issueCodes(result)));
  if (result.ok) assert.ok(result.warnings.some((entry) => entry.code === "UNDO_RECOMMENDED"));
});

test("shared registry collisions and canonical keyword abbreviations are rejected", () => {
  const cases: Array<{ name: string; draft: CustomCommandDraft; code: string }> = [
    {
      name: "exact command",
      draft: createBasicCustomCommand({
        deviceProfile: "router-ios-xe",
        context: "privileged",
        canonical: "show version",
        task: "Display software information.",
        explanation: "Returns version information.",
      }),
      code: "EXACT_COLLISION",
    },
    {
      name: "same argument grammar",
      draft: advanced("hostname Training-R2", "router-ios-xe", "global", "configuration"),
      code: "COMMAND_TREE_COLLISION",
    },
    {
      name: "abbreviation entered as canonical keyword",
      draft: createBasicCustomCommand({
        deviceProfile: "router-ios-xe",
        context: "privileged",
        canonical: "show ver",
        task: "Display custom verification output.",
        explanation: "Returns fictional verification output.",
      }),
      code: "AMBIGUOUS_KEYWORD",
    },
  ];
  for (const item of cases) {
    const result = validateCustomCommand(item.draft, { catalogue: commands });
    assert.equal(result.ok, false, item.name);
    assert.ok(issueCodes(result).includes(item.code), `${item.name}: ${JSON.stringify(issueCodes(result))}`);
    if (!result.ok) assert.ok(result.errors.every((entry) => entry.message.length > 30));
  }
});

test("router, switch and CLI-context gating use the selected shared profile", () => {
  const cases: Array<{
    name: string;
    draft: CustomCommandDraft;
    accepted: boolean;
    code?: string;
  }> = [
    {
      name: "switch command on Catalyst",
      draft: advanced("switchport protected", "catalyst-l2", "interface"),
      accepted: true,
    },
    {
      name: "switch command on router",
      draft: advanced("switchport protected", "router-ios-xe", "interface"),
      accepted: false,
      code: "PROFILE_COMMAND_MISMATCH",
    },
    {
      name: "route command on router",
      draft: advanced("ip route 203.0.113.0 255.255.255.0 192.0.2.9", "router-ios-xe", "global"),
      accepted: true,
    },
    {
      name: "route command on Layer 2 switch",
      draft: advanced("ip route 203.0.113.0 255.255.255.0 192.0.2.9", "catalyst-l2", "global"),
      accepted: false,
      code: "PROFILE_COMMAND_MISMATCH",
    },
    {
      name: "router context on Layer 2 switch",
      draft: advanced("distance 111", "catalyst-l2", "router"),
      accepted: false,
      code: "PROFILE_CONTEXT_MISMATCH",
    },
    {
      name: "VLAN context on router",
      draft: advanced("name LAB-USERS", "router-ios-xe", "vlan"),
      accepted: false,
      code: "PROFILE_CONTEXT_MISMATCH",
    },
  ];

  for (const item of cases) {
    const result = validateCustomCommand(item.draft);
    assert.equal(result.ok, item.accepted, `${item.name}: ${JSON.stringify(issueCodes(result))}`);
    if (item.code) assert.ok(issueCodes(result).includes(item.code), item.name);
  }
});

test("preview is sourced from help, Tab and parser-proven unambiguous shorthand", () => {
  const draft = createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser statistics",
    task: "Display fictional parser statistics.",
    explanation: "Returns bounded statistics without changing configuration.",
  });
  const result = validateCustomCommand(draft, { catalogue: commands });
  assert.equal(result.ok, true, JSON.stringify(issueCodes(result)));
  if (!result.ok) return;

  assert.equal(result.preview.questionMark.input, "show parser ");
  assert.equal(result.preview.questionMark.commandOption?.value, "statistics");
  assert.equal(result.preview.helpDescription, draft.semantics.helpDescription);
  assert.equal(result.preview.tab.changed, true);
  assert.equal(result.preview.tab.output.trim(), "show parser statistics");
  assert.ok(result.preview.shorthandExamples.length > 0);
  assert.ok(result.preview.shorthandExamples.length <= 3);

  const registry = buildCommandRegistry(
    [...commands, result.command],
    getDeviceProfile(result.active.deviceProfile),
  );
  for (const shorthand of result.preview.shorthandExamples) {
    const parsed = parseRegistryInput(registry, shorthand, result.active.mode);
    assert.equal(parsed.status, "valid", shorthand);
    if (parsed.status === "valid") assert.equal(parsed.event.command.id, result.active.id, shorthand);
    const abbreviated = shorthand.split(" ");
    const canonicalTokens: string[] = result.active.canonical.split(" ");
    assert.equal(abbreviated.length, canonicalTokens.length, shorthand);
    assert.ok(abbreviated.every((token, index) => canonicalTokens[index].toLowerCase().startsWith(token.toLowerCase())), shorthand);
  }
});

test("shell, evaluator and markup-like payloads remain inert data", () => {
  const unsafeCanonicals = [
    "show parser; touch injected",
    "show parser && node payload",
    "show `whoami`",
    "show $(payload)",
    "<script>alert(1)</script>",
  ];
  for (const canonical of unsafeCanonicals) {
    const result = validateCustomCommand(createBasicCustomCommand({
      deviceProfile: "router-ios-xe",
      context: "privileged",
      canonical,
      task: "Treat this as inert text.",
      explanation: "No payload may execute.",
    }));
    assert.equal(result.ok, false, canonical);
    assert.ok(issueCodes(result).includes("INVALID_CANONICAL"), canonical);
  }

  const marker = "__customCommandPayloadDidNotRun";
  Reflect.deleteProperty(globalThis, marker);
  const inertProse = `<script>globalThis.${marker}=true</script>`;
  const safe = createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser security",
    task: inertProse,
    explanation: "Markup-like prose remains text.",
  });
  const safeResult = validateCustomCommand(safe);
  assert.equal(safeResult.ok, true, JSON.stringify(issueCodes(safeResult)));
  if (safeResult.ok) assert.equal(safeResult.active.objective, inertProse);
  assert.equal(Reflect.has(globalThis, marker), false);

  let accessorInvoked = false;
  Object.defineProperty(safe.semantics, "effect", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      throw new Error("must not run");
    },
  });
  const accessorResult = validateCustomCommand(safe);
  assert.equal(accessorResult.ok, false);
  assert.equal(accessorInvoked, false);
});

test("length, control and bidirectional checks are table-driven and strict", () => {
  const base = createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser bounds",
    task: "Display bounded output.",
    explanation: "Returns bounded output.",
  });
  const cases: Array<{ field: string; mutate: (draft: CustomCommandDraft) => void; code: string }> = [
    {
      field: "objective length",
      mutate: (draft) => { draft.objective = "x".repeat(customCommandLimits.objective + 1); },
      code: "TOO_LONG",
    },
    {
      field: "canonical control",
      mutate: (draft) => { draft.canonical = "show\u0000 parser"; },
      code: "UNSAFE_TEXT",
    },
    {
      field: "why bidi",
      mutate: (draft) => { draft.semantics.why = "safe\u202etext"; },
      code: "UNSAFE_TEXT",
    },
    {
      field: "too many tags",
      mutate: (draft) => { draft.semantics.tags = Array.from({ length: customCommandLimits.tags + 1 }, (_, index) => `tag-${index}`); },
      code: "INVALID_LIST",
    },
  ];
  for (const item of cases) {
    const draft = structuredClone(base);
    item.mutate(draft);
    const result = validateCustomCommand(draft);
    assert.equal(result.ok, false, item.field);
    assert.ok(issueCodes(result).includes(item.code), `${item.field}: ${JSON.stringify(issueCodes(result))}`);
  }
});

test("legacy commands are retained verbatim, marked incomplete and never activated silently", () => {
  const legacy: Command & { extraNote: string } = {
    id: "custom.legacyABCD",
    mode: "privileged",
    canonical: "show fictional legacy",
    objective: "Display retained legacy output.",
    explanation: "An old memory note that is not silently promoted to semantics.",
    topic: "Custom",
    difficulty: 1,
    kind: "verification",
    custom: true,
    extraNote: "retain me",
  };
  const unsafeLegacy = { ...legacy, id: "bad", objective: "retained\u202etext" };
  const migrated = migrateLegacyCustomCommands([legacy, unsafeLegacy]);
  assert.equal(migrated.records.length, 2);
  const first = migrated.records[0];
  const second = migrated.records[1];
  if (first.status !== "incomplete" || second.status !== "incomplete") assert.fail("Legacy records must remain incomplete.");
  assert.equal(first.legacySource, legacy);
  assert.deepEqual(first.legacySource, legacy);
  assert.equal(first.legacy, true);
  assert.equal(first.deviceProfile, null);
  assert.equal(first.semantics.effect, null);
  assert.equal(first.semantics.why, "");
  assert.ok(first.issues.some((entry) => entry.code === "LEGACY_INCOMPLETE"));
  assert.equal(toRegistryCommand(first), null);
  assert.equal(second.objective, unsafeLegacy.objective);
  assert.equal(second.legacySource, unsafeLegacy);
  assert.ok(second.issues.some((entry) => entry.code === "UNSAFE_TEXT"));

  const malformedStore = migrateLegacyCustomCommands({ command: legacy });
  assert.equal(malformedStore.records.length, 0);
  assert.equal(malformedStore.storeIssues[0]?.code, "INVALID_RECORD");
});

test("version-2 active and incomplete records survive serialisation and reload safely", () => {
  const created = validateCustomCommand(createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser reload-view",
    task: "Display a fictional reload-safe parser view.",
    explanation: "Returns bounded output without changing configuration.",
  }), { catalogue: commands });
  assert.equal(created.ok, true, JSON.stringify(issueCodes(created)));
  if (!created.ok) return;

  const roundTripped = JSON.parse(JSON.stringify([created.active])) as unknown;
  const restored = migrateLegacyCustomCommands(roundTripped, { catalogue: commands });
  assert.equal(restored.records.length, 1);
  const active = restored.records[0];
  assert.equal(active.status, "active");
  if (active.status !== "active") return;
  assert.deepEqual(active.semantics, created.active.semantics);
  assert.deepEqual(toRegistryCommand(active), created.command);

  const explicitlyIncomplete = {
    ...JSON.parse(JSON.stringify(created.active)),
    status: "incomplete",
    legacy: false,
    issues: [],
  };
  const incompleteReload = migrateLegacyCustomCommands([explicitlyIncomplete], { catalogue: commands });
  const incomplete = incompleteReload.records[0];
  assert.equal(incomplete.status, "incomplete");
  if (incomplete.status !== "incomplete") return;
  assert.equal(incomplete.legacy, false);
  assert.equal(incomplete.canonical, created.active.canonical);
  assert.deepEqual(incomplete.semantics, created.active.semantics);
  assert.ok(incomplete.issues.some((entry) => entry.code === "INCOMPLETE_REVIEW"));
  assert.equal(toRegistryCommand(incomplete), null);

  const tamperedActive = JSON.parse(JSON.stringify(created.active));
  tamperedActive.semantics.effect = null;
  const retained = migrateLegacyCustomCommands([tamperedActive], { catalogue: commands }).records[0];
  assert.equal(retained.status, "incomplete");
  if (retained.status !== "incomplete") return;
  assert.equal(retained.canonical, created.active.canonical);
  assert.ok(retained.issues.some((entry) => entry.code === "INVALID_EFFECT"));
  assert.equal(toRegistryCommand(retained), null);

  const oldIncomplete = migrateLegacyCustomCommands([{
    id: "custom.oldReload1",
    mode: "privileged",
    canonical: "show retained old reload",
    objective: "Retain this old entry.",
    explanation: "Old note.",
    topic: "Custom",
    difficulty: 1,
    kind: "verification",
    custom: true,
  }]).records[0];
  const oldReload = migrateLegacyCustomCommands(JSON.parse(JSON.stringify([oldIncomplete]))).records[0];
  assert.equal(oldReload.status, "incomplete");
  if (oldReload.status !== "incomplete") return;
  assert.equal(oldReload.legacy, true);
  assert.equal(oldReload.canonical, "show retained old reload");
  assert.equal(toRegistryCommand(oldReload), null);
});

test("active command projection stays profile-specific", () => {
  const router = validateCustomCommand(createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser router-view",
    task: "Display a router-profile view.",
    explanation: "Returns fictional router-profile output.",
  }));
  const catalyst = validateCustomCommand(createBasicCustomCommand({
    deviceProfile: "catalyst-l2",
    context: "privileged",
    canonical: "show parser switch-view",
    task: "Display a switch-profile view.",
    explanation: "Returns fictional switch-profile output.",
  }));
  assert.equal(router.ok, true);
  assert.equal(catalyst.ok, true);
  if (!router.ok || !catalyst.ok) return;
  const records = [router.active, catalyst.active];
  assert.deepEqual(customCommandsForProfile(records, "router-ios-xe").map((command) => command.id), [router.active.id]);
  assert.deepEqual(customCommandsForProfile(records, "catalyst-l2").map((command) => command.id), [catalyst.active.id]);
});

test("custom store reconciliation preserves browser work only for an empty server", () => {
  const localValidation = validateCustomCommand(createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser local-view",
    task: "Display a fictional browser-only parser view.",
    explanation: "Returns bounded fictional output without changing configuration.",
  }), { catalogue: commands });
  const serverValidation = validateCustomCommand(createBasicCustomCommand({
    deviceProfile: "catalyst-l2",
    context: "privileged",
    canonical: "show parser server-view",
    task: "Display a fictional server parser view.",
    explanation: "Returns bounded fictional output without changing configuration.",
  }), { catalogue: commands });
  assert.equal(localValidation.ok, true);
  assert.equal(serverValidation.ok, true);
  if (!localValidation.ok || !serverValidation.ok) return;

  const local = [localValidation.active];
  const server = [serverValidation.active];
  const retained = reconcileCustomCommandStores(local, []);
  assert.equal(retained.retainedLocal, true);
  assert.deepEqual(retained.records, local);
  assert.notEqual(retained.records, local);

  const authoritative = reconcileCustomCommandStores(local, server);
  assert.equal(authoritative.retainedLocal, false);
  assert.deepEqual(authoritative.records, server);
  assert.notEqual(authoritative.records, server);
  assert.deepEqual(local, [localValidation.active]);
  assert.deepEqual(server, [serverValidation.active]);

  assert.deepEqual(reconcileCustomCommandStores([], []), { records: [], retainedLocal: false });
});

test("an authoritative custom store commit survives a failed browser mirror", () => {
  const validation = validateCustomCommand(createBasicCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show parser committed-view",
    task: "Display a fictional committed parser view.",
    explanation: "Returns bounded fictional output without changing configuration.",
  }), { catalogue: commands });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  let committed: CustomCommandRecord[] = [];
  const authoritative = [validation.active];
  const mirrored = commitAuthoritativeCustomCommandRecords(
    authoritative,
    (records) => { committed = records; },
    () => { throw new Error("synthetic quota failure"); },
  );
  assert.equal(mirrored, false);
  assert.deepEqual(committed, [validation.active]);
  assert.notEqual(committed, authoritative);
});
