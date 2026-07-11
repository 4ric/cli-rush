import assert from "node:assert/strict";
import test from "node:test";
import { cliHelp, completeCliInput } from "../../lib/cli-assistance.ts";
import { commands, type Command } from "../../lib/engine.ts";

const fixture: Command[] = [
  {
    id: "show.interface",
    mode: "privileged",
    canonical: "show ip interface brief",
    objective: "Show interface status.",
    explanation: "Shows interface status.",
    topic: "Interfaces",
    difficulty: 1,
    kind: "verification",
  },
  {
    id: "show.route",
    mode: "privileged",
    canonical: "show ip route",
    objective: "Show the routing table.",
    explanation: "Shows routes.",
    topic: "Routing",
    difficulty: 1,
    kind: "verification",
  },
  {
    id: "show.version",
    mode: "privileged",
    canonical: "show version",
    objective: "Show platform information.",
    explanation: "Shows the version.",
    topic: "Platform",
    difficulty: 1,
    kind: "verification",
  },
  {
    id: "show.inventory",
    mode: "privileged",
    canonical: "show inventory",
    objective: "Show installed hardware.",
    explanation: "Shows inventory.",
    topic: "Platform",
    difficulty: 1,
    kind: "verification",
  },
  {
    id: "user.show",
    mode: "user",
    canonical: "show history",
    objective: "Show command history.",
    explanation: "Shows history.",
    topic: "CLI",
    difficulty: 1,
    kind: "verification",
  },
];

test("Tab completes unique prefixes without guessing blank keywords", () => {
  assert.deepEqual(completeCliInput("", "privileged", fixture), {
    input: "",
    changed: false,
    assisted: false,
    matchingCommands: 0,
    message: "Type at least one character before pressing Tab.",
  });
  assert.equal(completeCliInput("sh", "privileged", fixture).input, "show ");
  assert.equal(completeCliInput("show ", "privileged", fixture).changed, false);
  assert.equal(completeCliInput("sh ip int br", "privileged", fixture).input, "show ip interface brief");
});

test("Tab remains deterministic for ambiguous, invalid and wrong-mode prefixes", () => {
  const ambiguous = completeCliInput("show i", "privileged", fixture);
  assert.equal(ambiguous.input, "show i");
  assert.equal(ambiguous.changed, false);
  assert.equal(ambiguous.assisted, false);

  assert.equal(completeCliInput("configure", "privileged", fixture).matchingCommands, 0);
  assert.equal(completeCliInput("show h", "privileged", fixture).matchingCommands, 0);
  assert.equal(completeCliInput("show h", "user", fixture).input, "show history");
});

test("question-mark help lists next tokens and a return marker contextually", () => {
  const root = cliHelp("", "privileged", fixture);
  assert.deepEqual(root.options.map((option) => option.value), ["show"]);
  assert.equal(root.assisted, true);

  const show = cliHelp("show ", "privileged", fixture);
  assert.deepEqual(show.options.map((option) => option.value), ["inventory", "ip", "version"]);
  assert.match(show.options[1].description, /2 matching commands/);

  const partial = cliHelp("show v", "privileged", fixture);
  assert.deepEqual(partial.options, [{
    value: "version",
    description: "Show platform information.",
  }]);

  const complete = cliHelp("show version ", "privileged", fixture);
  assert.deepEqual(complete.options, [{
    value: "<cr>",
    description: "Submit this complete command",
  }]);
});

test("question-mark help is neutral when no option matches", () => {
  const result = cliHelp("not-a-command ", "privileged", fixture);
  assert.equal(result.assisted, false);
  assert.equal(result.matchingCommands, 0);
  assert.deepEqual(result.options, []);
  assert.match(result.message, /No matching options/);
});

test("every built-in command remains safe input data for completion and help", () => {
  for (const command of commands) {
    const exact = completeCliInput(command.canonical, command.mode, commands);
    assert.equal(exact.input, command.canonical, command.id);
    assert.ok(exact.matchingCommands >= 1, command.id);

    const firstToken = command.canonical.split(/\s+/u)[0];
    const help = cliHelp(`${firstToken} `, command.mode, commands);
    assert.ok(help.options.length > 0 || help.matchingCommands === 0, command.id);
    for (const option of help.options) {
      assert.match(option.value, /\S/u, command.id);
      assert.match(option.description, /\S/u, command.id);
    }
  }
});
