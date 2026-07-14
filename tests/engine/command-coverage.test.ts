import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCommandInventoryBaseline,
  generateCommandCoverage,
  type CommandCoverageReport,
} from "../../lib/command-coverage.ts";
import {
  createAdvancedCustomCommand,
  migrateLegacyCustomCommands,
  validateCustomCommand,
} from "../../lib/custom-commands.ts";
import { commands } from "../../lib/engine.ts";

test("coverage derives and protects the documented built-in inventory", () => {
  const report = generateCommandCoverage(commands);

  assert.deepEqual(
    {
      learningObjectives: report.inventory.builtInLearningObjectives,
      distinctCanonicalCommands: report.inventory.builtInDistinctCanonicalCommands,
      cliModes: report.inventory.builtInCliModes,
      topics: report.inventory.builtInTopics,
    },
    {
      learningObjectives: 214,
      distinctCanonicalCommands: 203,
      cliModes: 9,
      topics: 25,
    },
  );
  assert.doesNotThrow(() => assertCommandInventoryBaseline(report));

  const reduced = generateCommandCoverage(commands.slice(1));
  assert.throws(
    () => assertCommandInventoryBaseline(reduced),
    /inventory regression for learningObjectives/iu,
  );
});

test("every supported profile/context production has an explicit derived classification", () => {
  const report = generateCommandCoverage(commands);

  assert.equal(report.productions.length, report.inventory.supportedProfileContextProductions);
  assert.equal(
    report.classifications.profileContextProductions.learningTask
      + report.classifications.profileContextProductions.contextualHelpOnly
      + report.classifications.profileContextProductions.administratorAdded,
    report.productions.length,
  );
  assert.equal(
    report.classifications.logicalProductions.learningTask
      + report.classifications.logicalProductions.contextualHelpOnly
      + report.classifications.logicalProductions.administratorAdded,
    report.inventory.supportedLogicalProductions,
  );
  assert.ok(report.classifications.profileContextProductions.learningTask > 0);
  assert.ok(report.classifications.profileContextProductions.contextualHelpOnly > 0);
  assert.equal(report.classifications.profileContextProductions.administratorAdded, 0);

  for (const production of report.productions) {
    assert.ok(production.id);
    assert.ok(production.profile);
    assert.ok(production.context);
    assert.ok(production.canonical);
    if (production.classification === "learning-task") {
      assert.equal(production.hasLearningTask, true);
      assert.equal(production.supplemental, false);
      assert.equal(production.administratorAdded, false);
    } else if (production.classification === "contextual-help-only") {
      assert.equal(production.hasLearningTask, false);
      assert.equal(production.supplemental, true);
      assert.equal(production.administratorAdded, false);
    }
  }
});

test("only active administrator commands enter the coverage report and retain their declared profile", () => {
  const draft = createAdvancedCustomCommand({
    deviceProfile: "router-ios-xe",
    context: "privileged",
    canonical: "show training-clock",
    task: "Display the deterministic training clock.",
    explanation: "Shows a simulated clock value without changing device state.",
    kind: "verification",
    difficulty: 1,
    helpDescription: "Display the deterministic training clock",
    effect: { type: "read-only", result: "A simulated clock line is displayed." },
    why: "A clock check gives timestamp context to later operational evidence.",
    progressiveHints: ["Use a read-only Privileged EXEC inspection command."],
    revealExplanation: "This displays the simulator clock and does not alter configuration.",
    verification: "Read the clock line and confirm the command left the prompt unchanged.",
    undo: "No rollback is required because this is read-only.",
    tags: ["operations"],
    prerequisites: [],
  });
  const validation = validateCustomCommand(draft, { catalogue: commands });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  const retainedLegacy = migrateLegacyCustomCommands([{
    id: "legacy.show",
    mode: "privileged",
    canonical: "show legacy-state",
    objective: "Old flat record",
    explanation: "Awaiting administrator review",
    topic: "Custom",
    difficulty: 1,
    kind: "verification",
    custom: true,
  }]).records[0];
  const report = generateCommandCoverage(commands, {
    customCommands: [validation.active, retainedLegacy],
  });
  const administratorRows = report.productions.filter(
    (production) => production.classification === "administrator-added",
  );

  assert.equal(report.inventory.administratorActiveCommands, 1);
  assert.equal(administratorRows.length, 1);
  assert.equal(administratorRows[0]?.id, validation.active.id);
  assert.equal(administratorRows[0]?.profile, "router-ios-xe");
  assert.equal(administratorRows[0]?.context, "privileged");
  assert.equal(administratorRows[0]?.canonical, "show training-clock");
  assert.equal(administratorRows[0]?.hasLearningTask, true);
  assert.equal(administratorRows[0]?.administratorAdded, true);
  assert.ok(report.productions.every((production) => production.id !== retainedLegacy.id));
});

test("inventory corrections and removals require an explicit migration note", () => {
  const report = generateCommandCoverage(commands, {
    documentedInventoryChanges: [{
      id: "example.corrected",
      action: "corrected",
      previousCanonical: "show   old",
      replacementId: "example.current",
      migration: "Stored review IDs map to example.current during versioned restore.",
    }],
  });
  assert.deepEqual(report.documentedInventoryChanges, [{
    id: "example.corrected",
    action: "corrected",
    previousCanonical: "show old",
    replacementId: "example.current",
    migration: "Stored review IDs map to example.current during versioned restore.",
  }]);
  assert.throws(
    () => generateCommandCoverage(commands, {
      documentedInventoryChanges: [{
        id: "example.removed",
        action: "removed",
        previousCanonical: "show removed",
        migration: "",
      }],
    }),
    /require an ID, previous canonical command and migration note/iu,
  );
});

test("the checked-in coverage artefact is the deterministic generated report", () => {
  const checkedIn = JSON.parse(readFileSync(
    new URL("../../validation/command-coverage.json", import.meta.url),
    "utf8",
  )) as CommandCoverageReport;
  const generated = generateCommandCoverage(commands);

  assert.deepEqual(checkedIn, generated);
});
