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
  assert.equal(completeCliInput("sh ip int br", "privileged", fixture).input, "sh ip int brief");
  assert.equal(completeCliInput("SH   ip int br", "privileged", fixture).input, "SH   ip int brief");
});

test("Tab remains deterministic for ambiguous, invalid and wrong-mode prefixes", () => {
  const ambiguous = completeCliInput("show i", "privileged", fixture);
  assert.equal(ambiguous.input, "show i");
  assert.equal(ambiguous.changed, false);
  assert.equal(ambiguous.assisted, false);

  assert.equal(completeCliInput("configure", "privileged", fixture).matchingCommands, 0);
  assert.equal(completeCliInput("show h", "privileged", fixture).matchingCommands, 0);
  assert.equal(completeCliInput("show h", "user", fixture).input, "show history");

  const variable = completeCliInput("ping 1", "user", commands);
  assert.equal(variable.input, "ping 1");
  assert.equal(variable.changed, false);
  assert.match(variable.message, /does not complete variable values/u);

  const keywordOrArgument = completeCliInput("show ip interface b", "privileged", commands);
  assert.equal(keywordOrArgument.input, "show ip interface b");
  assert.equal(keywordOrArgument.changed, false);
  assert.match(keywordOrArgument.message, /keyword or a variable value/u);
});

test("question-mark help lists next tokens and a return marker contextually", () => {
  const root = cliHelp("", "privileged", fixture);
  assert.deepEqual(root.options.map((option) => option.value), ["show"]);
  assert.equal(root.assisted, true);

  const show = cliHelp("show ", "privileged", fixture);
  assert.deepEqual(show.options.map((option) => option.value), ["inventory", "ip", "version"]);
  assert.equal(show.options[1].description, "Use IPv4 features");

  const partial = cliHelp("show v", "privileged", fixture);
  assert.deepEqual(partial.options, [{
    value: "version",
    description: "IOS XE command keyword",
  }]);

  const complete = cliHelp("show version ", "privileged", fixture);
  assert.deepEqual(complete.options, [{
    value: "<cr>",
    description: "Submit this syntactically complete command",
  }]);
});

test("question-mark help masks task values with parser-like grammar", () => {
  assert.deepEqual(cliHelp("ping ", "user", commands).options, [{
    value: "A.B.C.D",
    description: "IPv4 address",
  }]);
  assert.deepEqual(cliHelp("interface ", "global", commands).options, [{
    value: "INTERFACE",
    description: "Interface type and identifier",
  }]);
  assert.deepEqual(cliHelp("hostname ", "global", commands).options, [{
    value: "WORD",
    description: "Device hostname",
  }]);
  assert.deepEqual(cliHelp("vlan ", "global", commands).options, [{
    value: "<1-4094>",
    description: "VLAN identifier",
  }]);

  const address = cliHelp("ip address ", "interface", commands);
  assert.deepEqual(address.options, [{
    value: "A.B.C.D",
    description: "IPv4 interface address",
  }]);
  const mask = cliHelp("ip address 192.0.2.1 ", "interface", commands);
  assert.deepEqual(mask.options, [{
    value: "A.B.C.D",
    description: "IPv4 subnet mask",
  }]);
  assert.doesNotMatch(JSON.stringify([address, mask]), /192\.0\.2\.1|255\.255\.255\.0/u);
});

test("question-mark help is neutral when no option matches", () => {
  const result = cliHelp("not-a-command ", "privileged", fixture);
  assert.equal(result.assisted, false);
  assert.equal(result.matchingCommands, 0);
  assert.deepEqual(result.options, []);
  assert.match(result.message, /No matching options/);
});

test("every built-in command remains safe input data for completion and help", () => {
  assert.equal(commands.length, 214);
  for (const command of commands) {
    const exact = completeCliInput(command.canonical, command.mode, commands);
    assert.equal(exact.input, command.canonical, command.id);
    assert.ok(exact.matchingCommands >= 1, command.id);

    const help = cliHelp(`${command.canonical} `, command.mode, commands);
    assert.equal(help.options[0]?.value, "<cr>", command.id);
    for (const option of help.options) {
      assert.match(option.value, /\S/u, command.id);
      assert.match(option.description, /\S/u, command.id);
      assert.notEqual(option.description, command.objective, command.id);
    }
  }
});

test("Tab never reconstructs a multi-token command from token initials", () => {
  for (const command of commands) {
    const canonical = command.canonical.split(/\s+/u);
    if (canonical.length < 2) continue;

    const initials = canonical.map((token) => token[0]).join(" ");
    const priorInitials = initials.split(" ").slice(0, -1).join(" ");
    const completed = completeCliInput(initials, command.mode, commands);

    assert.equal(
      completed.input.split(" ").slice(0, -1).join(" "),
      priorInitials,
      `${command.id} changed an earlier abbreviation`,
    );
    assert.notEqual(
      completed.input.toLocaleLowerCase("en-GB"),
      command.canonical.toLocaleLowerCase("en-GB"),
      `${command.id} was disclosed by initials and one Tab press`,
    );
  }
});

test("context help never discloses built-in IPv4 literals", () => {
  const ipv4Literals = new Set(commands.flatMap((command) =>
    command.canonical.split(/\s+/u).filter((token) => /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(token))));

  for (const command of commands) {
    const tokens = command.canonical.split(/\s+/u);
    for (let index = 0; index < tokens.length; index += 1) {
      const prefix = tokens.slice(0, index).join(" ");
      const help = cliHelp(prefix ? `${prefix} ` : "", command.mode, commands);
      const renderedHelp = JSON.stringify(help.options);
      for (const literal of ipv4Literals) {
        assert.equal(renderedHelp.includes(literal), false, `${command.id} leaked ${literal}`);
      }
    }
  }
});
