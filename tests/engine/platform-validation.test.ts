import assert from "node:assert/strict";
import test from "node:test";
import { commands } from "../../lib/engine.ts";
import {
  catalogueValidationSummary,
  namedLabTargets,
  validationFor,
} from "../../lib/platform-validation.ts";

test("every built-in command is assigned to a named CML image target", () => {
  const knownTargets = new Set(namedLabTargets.map((target) => target.id));
  for (const command of commands) {
    const record = validationFor(command);
    assert.ok(record.targetIds.length > 0, command.id);
    assert.ok(record.targetIds.every((target) => knownTargets.has(target)), command.id);
  }
  const summary = catalogueValidationSummary(commands);
  assert.equal(summary.targetAssigned, commands.length);
});

test("source code does not fabricate licensed-image verification", () => {
  const summary = catalogueValidationSummary(commands);
  assert.equal(summary.imageVerified, 0);
  assert.ok(summary.documentationChecked > 0);
  assert.ok(summary.documentationChecked < summary.total);
});

test("the first IPv4 scenario commands carry an official documentation cross-check", () => {
  for (const id of [
    "nav.enable",
    "nav.configure",
    "nav.interface",
    "interface.ipv4",
    "interface.no-shutdown",
    "nav.end-interface",
    "show.ip-interface-brief",
    "config.save",
  ]) {
    const command = commands.find((entry) => entry.id === id)!;
    const record = validationFor(command);
    assert.equal(record.documentationStatus, "syntax-cross-checked", id);
    assert.match(record.documentationUrl ?? "", /^https:\/\/www\.cisco\.com\//u, id);
    assert.equal(record.labStatus, "pending-licensed-image", id);
  }
});
