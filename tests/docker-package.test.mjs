import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Compose keeps the service private, persistent and hardened", async () => {
  const compose = await read("compose.yaml");
  assert.match(compose, /127\.0\.0\.1:3080:3000/u);
  assert.match(compose, /\.\/data:\/data/u);
  assert.doesNotMatch(compose, /contrainers|0\.0\.0\.0:3080/u);
  assert.match(compose, /read_only: true/u);
  assert.match(compose, /no-new-privileges:true/u);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/u);
  assert.match(compose, /CLI_RUSH_PUBLIC_ORIGIN: \$\{CLI_RUSH_PUBLIC_ORIGIN:\?/u);
  assert.match(compose, /CLI_RUSH_PASSWORD_HASH_FILE: \/run\/secrets\/password_hash/u);
  assert.match(compose, /profiles: \["setup"\]/u);
});

test("Docker image has a pruned non-root runtime and health check", async () => {
  const dockerfile = await read("Dockerfile");
  assert.match(dockerfile, /apk add --no-cache bash/u);
  assert.match(dockerfile, /npm prune --omit=dev/u);
  assert.match(dockerfile, /USER node/u);
  assert.match(dockerfile, /HEALTHCHECK/u);
  assert.doesNotMatch(dockerfile, /COPY .*secrets|CLI_RUSH_SESSION_SECRET=/u);
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
