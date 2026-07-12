import assert from "node:assert/strict";
import test from "node:test";
import { teachingFor } from "../../lib/command-teaching.ts";
import { commands } from "../../lib/engine.ts";

test("every built-in command has substantive structured teaching content", () => {
  for (const command of commands) {
    const teaching = teachingFor(command);
    for (const [field, value] of Object.entries(teaching)) {
      assert.match(value, /\S/u, `${command.id} ${field}`);
      if (field !== "syntax") assert.ok(value.length >= 18, `${command.id} ${field} is too terse`);
    }
    assert.notEqual(command.explanation, command.objective, command.id);
    assert.equal(command.explanation, teaching.purpose, command.id);
    assert.match(teaching.syntax, /\S/u, command.id);
  }
});

test("teaching distinguishes purpose, verification, traps and rollback", () => {
  const address = commands.find((command) => command.id === "interface.ipv4")!;
  const teaching = teachingFor(address);
  assert.match(teaching.syntax, /<IPv4-address>/u);
  assert.match(teaching.syntax, /<subnet-mask>/u);
  assert.match(teaching.verify, /show ip interface brief/iu);
  assert.match(teaching.commonTrap, /mask|shut|peer/iu);
  assert.match(teaching.rollback, /no|default/iu);
  assert.match(teaching.mentalModel, /configuration|administrative|operational/iu);
  assert.match(teaching.workedExample, new RegExp(address.canonical.replaceAll(".", "\\."), "iu"));
});

test("pre-answer-safe explanations do not depend on teaching literals", () => {
  for (const command of commands) {
    const lower = command.canonical.toLocaleLowerCase("en-GB");
    const purpose = teachingFor(command).purpose.toLocaleLowerCase("en-GB");
    assert.equal(purpose.includes(lower), false, command.id);
  }
});
