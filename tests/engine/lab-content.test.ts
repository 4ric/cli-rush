import assert from "node:assert/strict";
import test from "node:test";
import {
  createRouterFoundationContent,
  createSwitchFoundationContent,
  labContentDefinitions,
} from "../../lib/lab-content.ts";

test("every foundation step uses the complete shared learning-content contract", () => {
  for (const lab of labContentDefinitions) {
    assert.equal(new Set(lab.steps.map((item) => item.id)).size, lab.steps.length, lab.id);
    assert.ok(lab.steps.length >= 35, lab.id);
    assert.equal(new Set(lab.steps.map((item) => item.hint1)).size, lab.steps.length, `${lab.id}: Hint 1 repeats`);
    assert.equal(new Set(lab.steps.map((item) => item.hint2)).size, lab.steps.length, `${lab.id}: Hint 2 repeats`);
    assert.equal(new Set(lab.steps.map((item) => item.commonFailure)).size, lab.steps.length, `${lab.id}: generic failure coaching repeats`);
    for (const item of lab.steps) {
      assert.ok(item.task.trim().split(/\s+/u).length <= 20, `${lab.id}/${item.id}`);
      assert.match(item.conceptId, /^lab\.[a-z0-9-]+$/u, `${lab.id}/${item.id}`);
      for (const value of [
        item.why,
        item.hint1,
        item.hint2,
        item.effect,
        item.verify,
        item.interpretation,
        item.commonFailure,
        item.recovery,
      ]) assert.ok(value.length >= 20, `${lab.id}/${item.id}`);
      assert.notEqual(item.hint1.trim().toLowerCase(), item.command.trim().toLowerCase(), `${lab.id}/${item.id}`);
      assert.equal(item.hint1.toLowerCase().includes(item.command.toLowerCase()), false, `${lab.id}/${item.id}: Hint 1 exposes the full command`);
      if (item.sensitiveArgumentNames?.length) {
        const secret = item.command.split(/\s+/u).at(-1)!;
        assert.equal(item.hint2.includes(secret), false, `${lab.id}/${item.id}: Hint 2 exposes a seeded secret`);
      }
      assert.doesNotMatch(
        `${item.hint1} ${item.interpretation} ${item.commonFailure}`,
        /Focus on the one stated outcome|compare the evidence with the intended state|valid keyword at the wrong prompt|current seeded values|stable simulated output is available/iu,
        `${lab.id}/${item.id}: generic placeholder coaching remains`,
      );
    }
  }
});

test("router foundation covers protected access, AAA fallback, SSH, DHCP, routing and save", () => {
  const lab = createRouterFoundationContent(73);
  const commands = new Set(lab.steps.map((item) => item.command));
  for (const expected of [
    "hostname R1",
    "enable secret Str0ngEnable!",
    "aaa new-model",
    "radius server RAD1",
    "aaa group server radius RAD-GRP",
    "server name RAD1",
    "aaa authentication login default group RAD-GRP local",
    "aaa authorization exec default group RAD-GRP local",
    "ip domain name lab.example",
    "crypto key generate rsa modulus 2048",
    "ip ssh version 2",
    "transport input ssh",
    "exec-timeout 10 0",
    "interface GigabitEthernet0/0/1",
    "ip address 192.168.10.1 255.255.255.0",
    "ip dhcp excluded-address 192.168.10.1 192.168.10.20",
    "ip dhcp pool USERS",
    "dns-server 192.0.2.53",
    "ip route 0.0.0.0 0.0.0.0 192.0.2.2",
    "show aaa servers",
    "show ip dhcp pool",
    "show ip dhcp binding",
    "show ip ssh",
    "copy running-config startup-config",
    "show startup-config",
  ]) assert.ok(commands.has(expected), expected);
  assert.ok(lab.steps.some((item) => item.id === "verify-fallback" && /separate simulated login/iu.test(item.task)));
  assert.ok(lab.steps.every((item) => !/(?:1\.1\.1\.1|8\.8\.8\.8|9\.9\.9\.9)/u.test(item.command)));
});

test("switch foundation covers three VLANs, edge ranges, voice, LACP, management and unused ports", () => {
  const lab = createSwitchFoundationContent(73);
  const commands = new Set(lab.steps.map((item) => item.command));
  for (const expected of [
    "hostname SW1",
    "vlan 10",
    "name DATA",
    "vlan 20",
    "name VOICE",
    "vlan 99",
    "name MANAGEMENT",
    "interface range FastEthernet1/0/1 - 4",
    "switchport mode access",
    "switchport access vlan 10",
    "switchport voice vlan 20",
    "spanning-tree portfast",
    "spanning-tree bpduguard enable",
    "switchport port-security",
    "switchport port-security maximum 2",
    "switchport port-security violation restrict",
    "interface range TenGigabitEthernet1/1/1 - 2",
    "channel-group 1 mode active",
    "interface Port-channel1",
    "switchport mode trunk",
    "switchport trunk allowed vlan 10,20,99",
    "interface Vlan99",
    "ip address 192.0.2.2 255.255.255.0",
    "ip default-gateway 192.0.2.1",
    "interface range FastEthernet1/0/9 - 24",
    "shutdown",
    "show interfaces status",
    "show interfaces trunk",
    "show spanning-tree",
    "show port-security",
    "show etherchannel summary",
    "ping 192.0.2.1",
    "copy running-config startup-config",
  ]) assert.ok(commands.has(expected), expected);
  assert.equal(lab.steps.some((item) => item.context === "dhcp" || /\bip dhcp pool\b/iu.test(item.command)), false);
  assert.match(lab.steps.find((item) => item.id === "voice-port-security-max")!.interpretation, /phone.*workstation.*(?:two|both).*MAC/iu);
});

test("seeded fictional secrets are deterministic but are not production constants", () => {
  const first = createRouterFoundationContent(73);
  const repeat = createRouterFoundationContent(73);
  const other = createRouterFoundationContent(74);
  const secretCommands = (lab: typeof first) => lab.steps
    .filter((item) => item.sensitiveArgumentNames?.length)
    .map((item) => item.command);
  assert.deepEqual(secretCommands(first), secretCommands(repeat));
  assert.notDeepEqual(secretCommands(first), secretCommands(other));
  assert.ok(secretCommands(first).some((command) => command === "enable secret Str0ngEnable!"));
});
