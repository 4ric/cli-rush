import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Compose keeps the service private, persistent and hardened", async () => {
  const compose = await read("compose.yaml");
  assert.match(compose, /CLI_RUSH_BIND_ADDRESS:-127\.0\.0\.1\}:3080:3000/u);
  assert.match(compose, /\.\/data:\/data/u);
  assert.doesNotMatch(compose, /contrainers|0\.0\.0\.0:3080/u);
  assert.match(compose, /read_only: true/u);
  assert.match(compose, /no-new-privileges:true/u);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/u);
  assert.match(compose, /CLI_RUSH_PUBLIC_ORIGIN: \$\{CLI_RUSH_PUBLIC_ORIGIN:\?/u);
  assert.match(compose, /CLI_RUSH_LOCAL_ORIGIN: \$\{CLI_RUSH_LOCAL_ORIGIN:-\}/u);
  assert.match(compose, /CLI_RUSH_USERNAME: \$\{CLI_RUSH_USERNAME:-admin\}/u);
  assert.match(compose, /CLI_RUSH_TRUST_PROXY_PEERS: \$\{CLI_RUSH_TRUST_PROXY_PEERS:-\}/u);
  assert.match(compose, /CLI_RUSH_PASSWORD_HASH_FILE: \/run\/secrets\/password_hash/u);
  assert.match(compose, /profiles: \["setup"\]/u);
  assert.doesNotMatch(compose, /init-storage:/u);
});

test("Docker image has a pruned non-root runtime and health check", async () => {
  const dockerfile = await read("Dockerfile");
  assert.match(dockerfile, /apk add --no-cache bash coreutils/u);
  assert.match(dockerfile, /npm prune --omit=dev/u);
  assert.match(dockerfile, /USER node/u);
  assert.match(dockerfile, /HEALTHCHECK/u);
  assert.doesNotMatch(dockerfile, /COPY .*secrets|CLI_RUSH_SESSION_SECRET=/u);
});

test("release automation builds and exercises the live Compose service", async () => {
  const workflow = await read(".github/workflows/release-qa.yml");
  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /npm run lint/u);
  assert.match(workflow, /npm test/u);
  assert.match(workflow, /docker compose config --quiet/u);
  assert.match(workflow, /docker compose build/u);
  assert.match(workflow, /docker compose up -d --no-build/u);
  assert.match(workflow, /State\.Health\.Status/u);
  assert.match(workflow, /http:\/\/127\.0\.0\.1:3080\/healthz/u);
  assert.match(workflow, /Sec-Fetch-Site: same-origin/u);
  assert.match(workflow, /randomBytes\(32\)/u);
  assert.doesNotMatch(workflow, /CLI_RUSH_PASSWORD_HASH=/u);
});

test("setup creates secrets before applying host-side runtime ownership", async () => {
  const setup = await read("scripts/docker-setup.sh");
  assert.ok(setup.indexOf("init-secrets") < setup.indexOf("chown 1000:1000 secrets/password_hash"));
  assert.match(setup, /chown -R 1000:1000 data/u);
  assert.match(setup, /chmod 0400 secrets\/password_hash secrets\/session_secret/u);
  assert.doesNotMatch(setup, /init-storage/u);
});

test("deployment package retains Sites identity but excludes removed starter database code", async () => {
  await access(new URL("../.openai/hosting.json", import.meta.url));
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.dependencies["drizzle-orm"], undefined);
  assert.equal(packageJson.devDependencies["drizzle-kit"], undefined);
  const ignore = await read(".dockerignore");
  assert.doesNotMatch(ignore, /^\.openai(?:\/|$)/mu);
  const deployment = await read("DOCKER-DEPLOY.md");
  assert.match(deployment, /\/data\/containers\/cli-rush/u);
});

test("sensitive configuration references cannot enter Git or the Docker build context", async () => {
  const dockerIgnore = await read(".dockerignore");
  const gitIgnore = await read(".gitignore");
  const referenceNames = [
    "big site router.txt",
    "big site switch1.txt",
    "big site switch2.txt",
    "big site switch3.txt",
    "small site router.txt",
    "small site switch1.txt",
    "small site switch2.txt",
  ];
  for (const name of referenceNames) {
    assert.match(dockerIgnore, new RegExp(name.replaceAll(" ", "\\s"), "u"));
    assert.match(gitIgnore, new RegExp(name.replaceAll(" ", "\\s"), "u"));
  }
  for (const directory of ["production-configs", "reference-configs", "source-configs"]) {
    assert.match(dockerIgnore, new RegExp(directory, "u"));
    assert.match(gitIgnore, new RegExp(directory, "u"));
  }
  for (const extension of ["*.cfg", "*.conf", "*.crt", "*.key", "*.p12", "*.pem", "*.pcap", "*.pcapng"]) {
    assert.match(dockerIgnore, new RegExp(extension.replace("*", "\\*"), "u"));
    assert.match(gitIgnore, new RegExp(extension.replace("*", "\\*"), "u"));
  }

  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts["scan:sensitive"], "node scripts/scan-sensitive-content.mjs");
  await access(new URL("../scripts/scan-sensitive-content.mjs", import.meta.url));
});

test("deployment examples use neutral identities and address placeholders", async () => {
  const environment = await read(".env.example");
  const compose = await read("compose.yaml");
  const deployment = await read("DOCKER-DEPLOY.md");
  assert.match(environment, /^CLI_RUSH_USERNAME=admin$/mu);
  assert.doesNotMatch(environment, /^CLI_RUSH_USERNAME=(?!admin$).+/mu);
  assert.match(compose, /CLI_RUSH_USERNAME:-admin/u);
  assert.match(deployment, /CLI_RUSH_BIND_ADDRESS=<server-lan-address>/u);
  const literalBindings = [...deployment.matchAll(/CLI_RUSH_BIND_ADDRESS=((?:\d{1,3}\.){3}\d{1,3})/gu)];
  assert.ok(literalBindings.every((match) => match[1] === "127.0.0.1"), "Only the safe loopback literal may appear in bind examples.");
  assert.match(deployment, /were not available in this workspace/u);
});
