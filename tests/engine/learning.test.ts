import assert from "node:assert/strict";
import test from "node:test";
import { commands, type Command } from "../../lib/engine.ts";
import {
  acceptedCommandContext,
  learningHintsFor,
  learningPoints,
  maskedCommandShape,
  safeCommandContext,
} from "../../lib/learning.ts";

const commandById = (id: string): Command => {
  const command = commands.find((candidate) => candidate.id === id);
  assert.ok(command, `Missing command fixture: ${id}`);
  return command;
};

test("navigation hints teach context recall without revealing the command", () => {
  const command = commandById("nav.configure");
  const hints = learningHintsFor(command);

  assert.equal(hints.strategy.assisted, false);
  assert.match(hints.strategy.text, /prompt/i);
  assert.doesNotMatch(hints.strategy.text, /configure terminal/i);
  assert.deepEqual(hints.structure, {
    text: "Structure: [movement or context] → [destination or scope, if required]. Token roles: [keyword] → [keyword]",
    assisted: true,
  });
  assert.equal(hints.family.text, "Command family: configure. Build the remaining keywords and arguments from the objective.");
  assert.deepEqual(hints.reveal, {
    text: "configure terminal",
    assisted: true,
  });
  assert.match(hints.postAnswerMnemonic, /“configure” → “terminal”/);
  assert.match(hints.postAnswerMnemonic, /prompt change/i);
});

test("verification hints organise the requested output into chunks", () => {
  const command = commandById("show.ip-interface-brief");
  const hints = learningHintsFor(command);

  assert.match(hints.strategy.text, /output/i);
  assert.equal(
    hints.structure.text,
    "Structure: [read operation] → [feature or subject] → [optional detail]. Token roles: [keyword] → [keyword] → [keyword] → [keyword]",
  );
  assert.equal(hints.structure.assisted, true);
  assert.equal(hints.reveal.text, command.canonical);
  assert.match(hints.postAnswerMnemonic, /“show ip” → “interface brief”/);
  assert.match(hints.postAnswerMnemonic, /inspection → subject/i);
});

test("configuration hints separate feature, action and values", () => {
  const command = commandById("interface.ipv4");
  const hints = learningHintsFor(command);

  assert.match(hints.strategy.text, /feature, action, target and value/i);
  assert.equal(
    hints.structure.text,
    "Structure: [feature] → [action] → [target] → [value, where required]. Token roles: [keyword] → [keyword] → [argument] → [argument]",
  );
  assert.equal(hints.reveal.assisted, true);
  assert.match(
    hints.postAnswerMnemonic,
    /“ip address” → “192\.0\.2\.1 255\.255\.255\.0”/,
  );
  assert.match(hints.postAnswerMnemonic, /state change/i);
});

test("semantic structure hides literals, initials and token lengths", () => {
  const shape = maskedCommandShape(
    "192.0.2.1 #Authorised flash: -l ::/0 10,20,99 network-team@example.com",
  );

  assert.equal(
    shape,
    "[argument] → [argument] → [argument] → [keyword] → [argument] → [argument] → [argument]",
  );
  assert.doesNotMatch(shape, /[.:#/@,-]/);
  assert.doesNotMatch(shape, /Authorised|flash|example|192\.0\.2\.1/i);
  assert.equal(maskedCommandShape("# / ::"), "[argument] → [argument] → [argument]");
});

test("semantic structures use the shared CLI grammar for hyphenated keywords", () => {
  for (const id of ["config.save", "config.password-encryption", "config.stp-mode", "router.passive"]) {
    const command = commandById(id);
    const hints = learningHintsFor(command);
    const keywordCount = command.canonical.split(/\s+/u)
      .filter((token) => /[a-z]/iu.test(token) && !/[\d.:/@#]/u.test(token))
      .length;
    assert.ok(hints.structure.text.split("[keyword]").length - 1 >= keywordCount, id);
  }
});

test("every built-in objective receives deterministic assistance metadata", () => {
  assert.equal(commands.length, 214);
  for (const command of commands) {
    const first = learningHintsFor(command);
    const second = learningHintsFor(command);

    assert.deepEqual(first, second, command.id);
    assert.equal(first.strategy.assisted, false, command.id);
    assert.equal(first.structure.assisted, true, command.id);
    assert.equal(first.family.assisted, true, command.id);
    assert.equal(first.reveal.assisted, true, command.id);
    assert.equal(first.reveal.text, command.canonical, command.id);
    assert.notEqual(first.structure.text, command.canonical, command.id);
    assert.equal(first.structure.text.includes(command.canonical), false, command.id);
    assert.equal(
      first.strategy.text.toLowerCase().includes(command.canonical.toLowerCase()),
      false,
      command.id,
    );
    assert.ok(first.strategy.text.length > 40, command.id);
    assert.ok(first.postAnswerMnemonic.includes("“"), command.id);
  }
});

test("learning points reward recall and streaks without crediting a reveal", () => {
  assert.equal(learningPoints(1, 1, 1, 0), 50);
  assert.equal(learningPoints(2, 1, 3, 0), 110);
  assert.equal(learningPoints(2, 1, 3, 1), 72);
  assert.equal(learningPoints(2, 1, 3, 2), 39);
  assert.equal(learningPoints(2, 2, 3, 0), 66);
  assert.equal(learningPoints(3, 1, 20, 0), 188);
  assert.equal(learningPoints(3, 1, 20, 3), 0);
});

test("every result can explain the concept and a practical use case safely", () => {
  for (const command of commands) {
    const safe = safeCommandContext(command);
    const accepted = acceptedCommandContext(command);
    assert.match(safe.explanation, /\S/u, command.id);
    assert.match(safe.useCase, /^Use it /u, command.id);
    assert.equal(
      safe.explanation.toLocaleLowerCase("en-GB").includes(command.canonical.toLocaleLowerCase("en-GB")),
      false,
      command.id,
    );
    assert.equal(accepted.explanation, command.explanation, command.id);
    assert.match(accepted.useCase, /^Use it /u, command.id);
  }
});
