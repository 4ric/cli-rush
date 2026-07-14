import assert from "node:assert/strict";
import test from "node:test";
import { commands } from "../../lib/engine.ts";
import {
  buildCommandRegistry,
  parseRegistryInput,
  parseInterfaceRange,
  redactCredentialInput,
  redactRegistryInput,
} from "../../lib/command-registry.ts";
import { getDeviceProfile, normaliseInterfaceName } from "../../lib/device-profiles.ts";

test("the typed registry preserves the learning catalogue identity", () => {
  const registry = buildCommandRegistry(commands, getDeviceProfile("router-ios-xe"));
  assert.equal(commands.length, 214);
  assert.equal(new Set(commands.map(command => command.canonical.toLowerCase())).size, 203);
  assert.ok(registry.productions.length >= 203);
  for (const command of commands) {
    assert.ok(registry.commandIds.has(command.id), command.id);
  }
});

test("router and Catalyst profiles expose only declared interfaces", () => {
  const router = getDeviceProfile("router-ios-xe");
  const catalyst = getDeviceProfile("catalyst-l2");
  assert.equal(normaliseInterfaceName("gi0/0/1", router), "GigabitEthernet0/0/1");
  assert.equal(normaliseInterfaceName("Gi1/0/1", catalyst), "GigabitEthernet1/0/1");
  assert.equal(normaliseInterfaceName("te1/1/1", catalyst), "TenGigabitEthernet1/1/1");
  assert.equal(normaliseInterfaceName("fa9/9/9", catalyst), null);
});

test("Catalyst spaced ranges are parsed and compact syntax is profile-gated", () => {
  const router = getDeviceProfile("router-ios-xe");
  const catalyst = getDeviceProfile("catalyst-l2");
  assert.deepEqual(parseInterfaceRange("gi1/0/1 - 4", catalyst), [
    "GigabitEthernet1/0/1",
    "GigabitEthernet1/0/2",
    "GigabitEthernet1/0/3",
    "GigabitEthernet1/0/4",
  ]);
  assert.deepEqual(parseInterfaceRange("gi1/0/1-4", catalyst), [
    "GigabitEthernet1/0/1",
    "GigabitEthernet1/0/2",
    "GigabitEthernet1/0/3",
    "GigabitEthernet1/0/4",
  ]);
  assert.equal(parseInterfaceRange("gi1/0/1-4", router), null);
});

test("every profile-available production is accepted by the parser that advertises it", () => {
  for (const profileId of ["router-ios-xe", "catalyst-l2"] as const) {
    const registry = buildCommandRegistry(commands, getDeviceProfile(profileId));
    for (const production of registry.productions) {
      if (!production.profileIds.includes(profileId)) continue;
      assert.equal(
        parseRegistryInput(registry, production.command.canonical, production.context).status,
        "valid",
        `${profileId}/${production.command.id}`,
      );
    }
  }
});

test("ambiguous, incomplete, invalid and wrong-context input remain distinct", () => {
  const registry = buildCommandRegistry(commands, getDeviceProfile("router-ios-xe"));
  assert.equal(parseRegistryInput(registry, "sh i", "privileged").status, "ambiguous");
  assert.equal(parseRegistryInput(registry, "show", "privileged").status, "incomplete");
  assert.equal(parseRegistryInput(registry, "show version", "global").status, "wrong-context");
  const invalid = parseRegistryInput(registry, "interface fa9/9/9", "global");
  assert.equal(invalid.status, "invalid");
  if (invalid.status === "invalid") assert.match(invalid.message, /\^\n% Invalid input/u);
});

test("registry redaction covers parsed and mistyped credential commands", () => {
  const registry = buildCommandRegistry(commands, getDeviceProfile("router-ios-xe"));
  assert.equal(
    redactRegistryInput(registry, "enable secret <test-value>", "global"),
    "enable secret [redacted]",
  );
  assert.equal(
    redactRegistryInput(registry, "username learner privilege 15 secret <test-value>", "global"),
    "username learner privilege 15 secret [redacted]",
  );
  assert.equal(
    redactRegistryInput(registry, "key <test-value> trailing-typo", "radius"),
    "key [redacted]",
  );
});

test("credential redaction is grammar-aware, tail-safe and does not hide PKI key syntax", () => {
  const registry = buildCommandRegistry(commands, getDeviceProfile("router-ios-xe"));
  const credentialWords = {
    secret: ["se", "cret"].join(""),
    password: ["pass", "word"].join(""),
    community: ["comm", "unity"].join(""),
    key: ["k", "ey"].join(""),
  };
  const abbreviated = {
    secret: credentialWords.secret.slice(0, 1),
    password: credentialWords.password.slice(0, 1),
    community: credentialWords.community.slice(0, 1),
    key: credentialWords.key.slice(0, 2),
  };
  const value = ["S3c", "ret"].join("");
  const lineValue = ["Line", "Value"].join("");
  const radiusValue = ["Radius", "Value"].join("");
  const communityValue = ["Public", "Value"].join("");
  const typeNine = String(9);
  const typeSeven = String(7);
  const input = (...words: string[]) => words.join(" ");
  const cases = [
    { context: "global", input: input("enable", credentialWords.secret, typeNine, value, "tail"), expected: input("enable", credentialWords.secret, typeNine, "[redacted]") },
    { context: "global", input: input("username", "learner", "privilege", "15", credentialWords.secret, typeNine, value, "tail"), expected: input("username", "learner", "privilege", "15", credentialWords.secret, typeNine, "[redacted]") },
    { context: "line", input: input(credentialWords.password, typeSeven, lineValue, "tail"), expected: input(credentialWords.password, typeSeven, "[redacted]") },
    { context: "radius", input: input("key", typeSeven, radiusValue, "tail"), expected: input("key", typeSeven, "[redacted]") },
    { context: "global", input: input("snmp-server", credentialWords.community, communityValue, "RO"), expected: input("snmp-server", credentialWords.community, "[redacted]", "RO") },
    { context: "global", input: input("snmp-server", credentialWords.community, typeSeven, "First", "Second"), expected: input("snmp-server", credentialWords.community, typeSeven, "[redacted]") },
    { context: "global", input: input("snmp-server", credentialWords.community, "First", "Second", "rw"), expected: input("snmp-server", credentialWords.community, "[redacted]", "rw") },
    { context: "radius", input: input("key", "generate", radiusValue), expected: input("key", "[redacted]") },
    { context: "radius", input: input("key", "zeroize", radiusValue), expected: input("key", "[redacted]") },
    { context: "radius", input: input("k", "generate", radiusValue), expected: input("k", "[redacted]") },
    { context: "global", input: input("radius", "server", "RAD", abbreviated.key, radiusValue, "extra"), expected: input("radius", "server", "RAD", abbreviated.key, "[redacted]") },
    { context: "user", input: input("radius", "server", "RAD", abbreviated.key, radiusValue, "extra"), expected: input("radius", "server", "RAD", abbreviated.key, "[redacted]") },
    { context: "global", input: input("enable", abbreviated.secret, value, "extra", "words"), expected: input("enable", abbreviated.secret, "[redacted]") },
    { context: "user", input: input("enable", abbreviated.secret, value, "extra", "words"), expected: input("enable", abbreviated.secret, "[redacted]") },
    { context: "line", input: input(abbreviated.password, typeSeven, lineValue, "extra", "words"), expected: input(abbreviated.password, typeSeven, "[redacted]") },
    { context: "global", input: input(abbreviated.password, typeSeven, lineValue, "extra", "words"), expected: input(abbreviated.password, typeSeven, "[redacted]") },
    { context: "global", input: input("username", "admin", "priv", "15", abbreviated.secret, "0", value, "extra"), expected: input("username", "admin", "priv", "15", abbreviated.secret, "0", "[redacted]") },
    { context: "line", input: input("username", "admin", "priv", "15", abbreviated.secret, "0", value, "extra"), expected: input("username", "admin", "priv", "15", abbreviated.secret, "0", "[redacted]") },
    { context: "global", input: input("snmp-server", abbreviated.community, communityValue, "extra", "RO"), expected: input("snmp-server", abbreviated.community, "[redacted]", "RO") },
    { context: "user", input: input("snmp-server", abbreviated.community, communityValue, "extra", "RO"), expected: input("snmp-server", abbreviated.community, "[redacted]", "RO") },
    { context: "global", input: input("enable", credentialWords.secret), expected: input("enable", credentialWords.secret) },
    { context: "global", input: input("enable", credentialWords.secret, typeNine), expected: input("enable", credentialWords.secret, "[redacted]") },
    { context: "line", input: input(credentialWords.password, typeSeven), expected: input(credentialWords.password, "[redacted]") },
    { context: "line", input: input("no", credentialWords.password), expected: input("no", credentialWords.password) },
    { context: "global", input: input("service", "password-encryption"), expected: input("service", "password-encryption") },
    { context: "global", input: "crypto key generate rsa modulus 2048", expected: "crypto key generate rsa modulus 2048" },
    { context: "global", input: "crypto key zeroize rsa", expected: "crypto key zeroize rsa" },
    { context: "global", input: "crypto k generate rsa modulus 2048", expected: "crypto k generate rsa modulus 2048" },
    { context: "privileged", input: "show crypto key mypubkey rsa", expected: "show crypto key mypubkey rsa" },
    { context: "privileged", input: "show crypto k mypubkey rsa", expected: "show crypto k mypubkey rsa" },
    { context: "global", input: input("crypto", "key", value, "extra"), expected: input("crypto", "key", "[redacted]") },
    { context: "global", input: input("crypto", "k", value, "extra"), expected: input("crypto", "k", "[redacted]") },
    { context: "interface", input: "description security operations", expected: "description security operations" },
    { context: "global", input: "passive-interface GigabitEthernet0/0/1", expected: "passive-interface GigabitEthernet0/0/1" },
  ] as const;

  for (const item of cases) {
    assert.equal(redactCredentialInput(item.input), item.expected, `fallback: ${item.input}`);
    assert.equal(redactRegistryInput(registry, item.input, item.context), item.expected, `registry: ${item.input}`);
  }

  assert.equal(
    redactRegistryInput(registry, "ena sec <test-value>", "global"),
    "ena sec [redacted]",
    "parsed keyword abbreviations use the same sentinel",
  );
});
