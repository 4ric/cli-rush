import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const projectRoot = path.resolve(import.meta.dirname, "../..");

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const waitForHealth = async (origin, child) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Authentication server stopped with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Authentication server did not become ready.");
};

test("single-user gateway protects the app and persists validated custom commands", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cli-rush-auth-test-"));
  const secrets = path.join(temporary, "secrets");
  const data = path.join(temporary, "data");
  await mkdir(secrets);
  const password = "Correct-Horse-Battery-Only-A-Test";
  const salt = randomBytes(24);
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const passwordHash = ["scrypt", "32768", "8", "1", salt.toString("base64url"), Buffer.from(derived).toString("base64url")].join("$");
  await writeFile(path.join(secrets, "password_hash"), passwordHash);
  await writeFile(path.join(secrets, "session_secret"), randomBytes(48).toString("base64url"));

  const port = await freePort();
  const internalPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const publicOrigin = "https://cli-rush.example.test";
  const child = spawn(process.execPath, ["server/auth-server.mjs"], {
    cwd: projectRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      CLI_RUSH_INTERNAL_PORT: String(internalPort),
      CLI_RUSH_DATA_DIR: data,
      CLI_RUSH_USERNAME: "ignas",
      CLI_RUSH_COOKIE_SECURE: "true",
      CLI_RUSH_TRUST_PROXY: "true",
      CLI_RUSH_PUBLIC_ORIGIN: publicOrigin,
      CLI_RUSH_LOCAL_ORIGIN: origin,
      CLI_RUSH_PASSWORD_HASH_FILE: path.join(secrets, "password_hash"),
      CLI_RUSH_SESSION_SECRET_FILE: path.join(secrets, "session_secret"),
    },
  });
  t.after(() => child.kill("SIGTERM"));
  await waitForHealth(origin, child);

  const unauthenticated = await fetch(`${origin}/`, { redirect: "manual" });
  assert.equal(unauthenticated.status, 303);
  assert.equal(unauthenticated.headers.get("location"), "/login");

  const rejectedOrigin = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://192.0.2.50", "sec-fetch-site": "same-origin" },
    body: new URLSearchParams({ username: "ignas", password }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const wrong = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin, "sec-fetch-site": "same-origin" },
    body: new URLSearchParams({ username: "ignas", password: "wrong" }),
  });
  assert.equal(wrong.status, 401);

  const login = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({ username: "ignas", password }),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^cli_rush_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.doesNotMatch(cookie, /; Secure/i);

  const authenticated = await fetch(`${origin}/`, { headers: { cookie } });
  assert.equal(authenticated.status, 200);

  const publicRequestHeaders = {
    host: "cli-rush.example.test",
    origin: publicOrigin,
    "sec-fetch-site": "same-origin",
    "x-forwarded-for": "192.0.2.10",
    "x-forwarded-proto": "https",
  };
  const publicLogin = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { ...publicRequestHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "ignas", password }),
  });
  assert.equal(publicLogin.status, 303);
  const publicCookie = publicLogin.headers.get("set-cookie");
  assert.match(publicCookie, /^__Host-cli_rush_session=/);
  assert.match(publicCookie, /; Secure/i);
  const publicAuthenticated = await fetch(`${origin}/`, {
    headers: { ...publicRequestHeaders, cookie: publicCookie },
  });
  assert.equal(publicAuthenticated.status, 200);

  const rejectedWrite = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: "[]",
  });
  assert.equal(rejectedWrite.status, 403);

  const custom = [{
    id: "custom.abcdefgh",
    objective: "Display test data.",
    canonical: "show test",
    explanation: "A test-only command.",
    topic: "Custom",
    mode: "privileged",
    kind: "verification",
    difficulty: 1,
  }];
  const saved = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify(custom),
  });
  assert.equal(saved.status, 200);
  const restored = await fetch(`${origin}/api/custom-commands`, { headers: { cookie } });
  assert.deepEqual((await restored.json()).map((item) => item.canonical), ["show test"]);

  const registration = await fetch(`${origin}/register`, { headers: { cookie }, redirect: "manual" });
  assert.equal(registration.status, 404);

  const logout = await fetch(`${origin}/logout`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, origin },
  });
  assert.equal(logout.status, 303);
});
