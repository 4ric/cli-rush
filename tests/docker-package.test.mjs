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
