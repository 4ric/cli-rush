import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatFindings,
  scanSensitiveContent,
  trackedFiles,
} from "../../scripts/scan-sensitive-content.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const fixture = async (relativePath, content) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-rush-privacy-"));
  await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await writeFile(path.join(root, relativePath), content);
  return { root, files: [relativePath] };
};

test("the repository tracked source contains no blocked sensitive content", async () => {
  const findings = await scanSensitiveContent({ root: repositoryRoot, files: trackedFiles(repositoryRoot), includeDist: false });
  assert.deepEqual(findings, [], formatFindings(findings));
});

test("the scanner blocks named source references without reading or printing their values", async () => {
  const sensitiveValue = ["do", "-not", "-print", "-this"].join("");
  const input = await fixture("references/big site router.txt", sensitiveValue);
  const findings = await scanSensitiveContent({ ...input, includeDist: false });
  assert.deepEqual(findings.map((finding) => finding.rule), ["prohibited-source-reference"]);
  assert.doesNotMatch(formatFindings(findings), new RegExp(sensitiveValue, "u"));

  const renamed = await fixture("uploads/router.cfg", sensitiveValue);
  assert.deepEqual(
    (await scanSensitiveContent({ ...renamed, includeDist: false })).map((finding) => finding.rule),
    ["prohibited-source-reference"],
  );
  assert.deepEqual(
    (await scanSensitiveContent({ root: renamed.root, files: [], includeDist: false })).map((finding) => finding.rule),
    ["prohibited-source-reference"],
    "Ignored or otherwise unlisted sensitive references must still be discovered by filename without reading their content.",
  );
});

test("the scanner blocks credential, certificate, VPN and non-documentation endpoint material", async () => {
  const publicEndpoint = ["8", "8", "4", "4"].join(".");
  const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const radiusCommand = ["key ", "Not-A-Repository-Fixture!"].join("");
  const vpnCommand = ["crypto ", "ipsec transform-set SAMPLE"].join("");
  const applicationSecret = ["CLI_RUSH_SESSION_", "SECRET=not-for-source-control"].join("");
  const yamlApplicationSecret = ["\"CLI_RUSH_PASSWORD_", "HASH\": \"not-for-source-control\""].join("");
  const content = [publicEndpoint, privateKeyMarker, radiusCommand, vpnCommand, applicationSecret, yamlApplicationSecret].join("\n");
  const input = await fixture("sample.txt", content);
  const findings = await scanSensitiveContent({ ...input, includeDist: false });
  assert.deepEqual(new Set(findings.map((finding) => finding.rule)), new Set([
    "certificate-or-private-key-block",
    "direct-application-secret",
    "literal-credential-or-community",
    "non-documentation-public-ipv4",
    "vpn-or-tunnel-key-material",
  ]));
  const report = formatFindings(findings);
  for (const value of [publicEndpoint, radiusCommand, privateKeyMarker, applicationSecret]) {
    assert.doesNotMatch(report, new RegExp(value, "u"));
  }

  const built = await fixture("dist/client/generated.js", `const endpoint = "${publicEndpoint}";`);
  assert.deepEqual(
    (await scanSensitiveContent({ root: built.root, files: [], includeDist: true })).map((finding) => finding.rule),
    ["non-documentation-public-ipv4"],
  );

  const generatedAssignments = await fixture("dist/client/generated.js", [
    ["key ", "= \"$generated\";"].join(""),
    ["key ", "+= \"[image]\";"].join(""),
  ].join("\n"));
  assert.deepEqual(await scanSensitiveContent({ root: generatedAssignments.root, files: [], includeDist: true }), []);
  const literalKeyInCode = await fixture("sample.js", ["key ", "Literal-Secret-Value"].join(""));
  assert.deepEqual(
    (await scanSensitiveContent({ ...literalKeyInCode, includeDist: false })).map((finding) => finding.rule),
    ["literal-credential-or-community"],
  );
  const quotedOperatorCredentials = await fixture("sample.js", [
    ["const cli = \"key ", "+=\""].join(""),
    ["const cli2 = \"enable secret ", "=\""].join(""),
  ].join("\n"));
  assert.deepEqual(
    (await scanSensitiveContent({ ...quotedOperatorCredentials, includeDist: false })).map((finding) => finding.rule),
    ["literal-credential-or-community", "literal-credential-or-community"],
  );

  const privateDeploymentAddress = ["192", "168", "50", "10"].join(".");
  const privateDeploymentIpv6 = ["fd00", "50", "", "10"].join(":");
  const deployment = await fixture(".env.example", [
    `CLI_RUSH_BIND_ADDRESS=${privateDeploymentAddress}`,
    `CLI_RUSH_TRUST_PROXY_PEERS=${privateDeploymentIpv6}`,
  ].join("\n"));
  assert.deepEqual(
    new Set((await scanSensitiveContent({ ...deployment, includeDist: false })).map((finding) => finding.rule)),
    new Set(["private-deployment-ipv4", "private-deployment-ipv6"]),
  );
});

test("the scanner permits documentation networks, fictional private labs and only the authorised seeded fixture", async () => {
  const authorisedSeed = ["Str0ng", "Enable!"].join("");
  const safe = [
    "ip route 0.0.0.0 0.0.0.0 192.0.2.1",
    "ip address 192.168.50.2 255.255.255.0",
    `step("enable-secret", "security", "global", "enable secret ${authorisedSeed}", "Fixture");`,
  ].join("\n");
  const input = await fixture("lib/lab-content.ts", safe);
  assert.deepEqual(await scanSensitiveContent({ ...input, includeDist: false }), []);
  const coverage = await fixture("tests/engine/lab-content.test.ts", [
    `  "enable secret ${authorisedSeed}",`,
    `assert.ok(secretCommands(first).some((command) => command === "enable secret ${authorisedSeed}"));`,
  ].join("\n"));
  assert.deepEqual(await scanSensitiveContent({ ...coverage, includeDist: false }), []);

  const wrongLocation = await fixture("lib/other.ts", `enable secret ${authorisedSeed}`);
  assert.deepEqual(
    (await scanSensitiveContent({ ...wrongLocation, includeDist: false })).map((finding) => finding.rule),
    ["literal-credential-or-community"],
  );

  const copiedWithinSourceFile = await fixture("lib/lab-content.ts", `const copied = "enable secret ${authorisedSeed}";`);
  assert.deepEqual(
    (await scanSensitiveContent({ ...copiedWithinSourceFile, includeDist: false })).map((finding) => finding.rule),
    ["literal-credential-or-community"],
  );

  const copiedWithinCoverage = await fixture("tests/engine/lab-content.test.ts", `const copied = "enable secret ${authorisedSeed}";`);
  assert.deepEqual(
    (await scanSensitiveContent({ ...copiedWithinCoverage, includeDist: false })).map((finding) => finding.rule),
    ["literal-credential-or-community"],
  );
});
