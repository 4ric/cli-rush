import assert from "node:assert/strict";
import test from "node:test";
import { navigateCommandHistory } from "../../lib/command-history.ts";

test("Up recalls submitted commands from newest to oldest", () => {
  const entries = ["enable", "show ip route", "configure terminal"];
  const newest = navigateCommandHistory(entries, "sho", -1, "", "older");
  assert.deepEqual(newest, {
    value: "configure terminal",
    index: 2,
    draft: "sho",
  });

  const previous = navigateCommandHistory(
    entries,
    newest.value,
    newest.index,
    newest.draft,
    "older",
  );
  assert.equal(previous.value, "show ip route");
  assert.equal(previous.index, 1);

  const oldest = navigateCommandHistory(entries, previous.value, 0, previous.draft, "older");
  assert.equal(oldest.value, "enable");
  assert.equal(oldest.index, 0);
});

test("Down moves towards newer commands and restores the unfinished draft", () => {
  const entries = ["enable", "show ip route"];
  const newer = navigateCommandHistory(entries, "enable", 0, "sh", "newer");
  assert.deepEqual(newer, {
    value: "show ip route",
    index: 1,
    draft: "sh",
  });

  const draft = navigateCommandHistory(entries, newer.value, newer.index, newer.draft, "newer");
  assert.deepEqual(draft, { value: "sh", index: -1, draft: "sh" });
});

test("history navigation is inert when no submitted command is available", () => {
  assert.deepEqual(navigateCommandHistory([], "show", -1, "", "older"), {
    value: "show",
    index: -1,
    draft: "show",
  });
  assert.deepEqual(navigateCommandHistory(["enable"], "show", -1, "", "newer"), {
    value: "show",
    index: -1,
    draft: "show",
  });
});
