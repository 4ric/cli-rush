import assert from "node:assert/strict";
import test from "node:test";
import { commands, type Command } from "../../lib/engine.ts";
import { learningHintsFor, learningPoints, maskedCommandShape } from "../../lib/learning.ts";

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
  assert.deepEqual(hints.shape, {
    text: "c••••••••[9] t•••••••[8]",
    assisted: true,
  });
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
    hints.shape.text,
    "s•••[4] i•[2] i••••••••[9] b••••[5]",
  );
  assert.equal(hints.shape.assisted, true);
  assert.equal(hints.reveal.text, command.canonical);
  assert.match(hints.postAnswerMnemonic, /“show ip” → “interface brief”/);
  assert.match(hints.postAnswerMnemonic, /inspection → subject/i);
});

test("configuration hints separate feature, action and values", () => {
  const command = commandById("interface.ipv4");
  const hints = learningHintsFor(command);

  assert.match(hints.strategy.text, /feature, action, target and value/i);
  assert.equal(
    hints.shape.text,
    "i•[2] a••••••[7] 1••••••••[9] 2••••••••••••[13]",
  );
  assert.equal(hints.reveal.assisted, true);
  assert.match(
    hints.postAnswerMnemonic,
    /“ip address” → “192\.0\.2\.1 255\.255\.255\.0”/,
  );
  assert.match(hints.postAnswerMnemonic, /state change/i);
});

test("shape masking hides IP and punctuation while retaining initials and lengths", () => {
  const shape = maskedCommandShape(
    "192.0.2.1 #Authorised flash: -l ::/0 10,20,99 network-team@example.com",
  );

  assert.equal(
    shape,
    "1••••••••[9] A••••••••••[11] f•••••[6] l•[2] 0•••[4] 1•••••••[8] n•••••••••••••••••••••••[24]",
  );
  assert.doesNotMatch(shape, /[.:#/@,-]/);
  assert.doesNotMatch(shape, /Authorised|flash|example|192\.0\.2\.1/i);
  assert.equal(maskedCommandShape("# / ::"), "•[1] •[1] ••[2]");
});

test("every built-in objective receives deterministic assistance metadata", () => {
  assert.equal(commands.length, 214);
  for (const command of commands) {
    const first = learningHintsFor(command);
    const second = learningHintsFor(command);

    assert.deepEqual(first, second, command.id);
    assert.equal(first.strategy.assisted, false, command.id);
    assert.equal(first.shape.assisted, true, command.id);
    assert.equal(first.reveal.assisted, true, command.id);
    assert.equal(first.reveal.text, command.canonical, command.id);
    assert.notEqual(first.shape.text, command.canonical, command.id);
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
  assert.equal(learningPoints(2, 1, 3, 1), 55);
  assert.equal(learningPoints(2, 2, 3, 0), 66);
  assert.equal(learningPoints(3, 1, 20, 0), 188);
  assert.equal(learningPoints(3, 1, 20, 2), 0);
});
