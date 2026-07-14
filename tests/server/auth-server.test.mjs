import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
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

const requestOnLocalSocket = ({ port, pathName = "/", method = "GET", headers = {}, body = "" }) => new Promise((resolve, reject) => {
  const request = http.request({ hostname: "127.0.0.1", port, path: pathName, method, headers }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
      status: response.statusCode,
      headers: response.headers,
    })));
  });
  request.once("error", reject);
  if (body) request.write(String(body));
  request.end();
});

const sendRawHttp = (port, payload) => new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  let response = "";
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.end(payload));
  socket.on("data", (chunk) => { response += chunk; });
  socket.once("end", () => resolve(response));
  socket.once("error", reject);
});

test("public gateway origin must use HTTPS while the separate local origin may use HTTP", async () => {
  const child = spawn(process.execPath, ["server/auth-server.mjs"], {
    cwd: projectRoot,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      CLI_RUSH_PUBLIC_ORIGIN: "http://cli-rush.example.test",
      CLI_RUSH_LOCAL_ORIGIN: "http://127.0.0.1:3080",
    },
  });
  let errorOutput = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errorOutput += chunk; });
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(errorOutput, /CLI_RUSH_PUBLIC_ORIGIN must use HTTPS/u);
});

test("single-user gateway protects the app and persists validated custom commands", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cli-rush-auth-test-"));
  const secrets = path.join(temporary, "secrets");
  const data = path.join(temporary, "data");
  await mkdir(secrets);
  const password = `Test-${randomBytes(24).toString("base64url")}`;
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
      CLI_RUSH_USERNAME: "admin",
      CLI_RUSH_COOKIE_SECURE: "true",
      CLI_RUSH_TRUST_PROXY: "true",
      CLI_RUSH_TRUST_PROXY_PEERS: "",
      CLI_RUSH_PUBLIC_ORIGIN: publicOrigin,
      CLI_RUSH_LOCAL_ORIGIN: origin,
      CLI_RUSH_PASSWORD_HASH_FILE: path.join(secrets, "password_hash"),
      CLI_RUSH_SESSION_SECRET_FILE: path.join(secrets, "session_secret"),
    },
  });
  t.after(() => child.kill("SIGTERM"));
  await waitForHealth(origin, child);

  const malformedTarget = await sendRawHttp(port, "GET http://[::1 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
  assert.match(malformedTarget, /^HTTP\/1\.1 400\b/u);
  assert.equal((await fetch(`${origin}/healthz`)).status, 200, "A malformed request target must not stop the gateway.");

  const unauthenticated = await fetch(`${origin}/`, { redirect: "manual" });
  assert.equal(unauthenticated.status, 303);
  assert.equal(unauthenticated.headers.get("location"), "/login");
  assert.equal(unauthenticated.headers.get("referrer-policy"), "same-origin");

  const rejectedWithoutSource = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(rejectedWithoutSource.status, 403);

  const rejectedOrigin = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://192.0.2.50", "sec-fetch-site": "same-origin" },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const wrong = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin, "sec-fetch-site": "same-origin" },
    body: new URLSearchParams({ username: "admin", password: "wrong" }),
  });
  assert.equal(wrong.status, 401);

  const login = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^cli_rush_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.doesNotMatch(cookie, /; Secure/i);

  const authenticated = await fetch(`${origin}/`, { headers: { cookie } });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.headers.get("cache-control"), "no-store");
  const unknownHostReplay = await requestOnLocalSocket({
    port,
    headers: { host: "attacker.invalid", cookie },
  });
  assert.equal(unknownHostReplay.status, 421, "A valid session must not authenticate an unconfigured destination Host.");
  const cacheableIcon = await fetch(`${origin}/icon-192.png`, { headers: { cookie } });
  assert.equal(cacheableIcon.status, 200);
  assert.match(cacheableIcon.headers.get("content-type") ?? "", /^image\/png\b/u);
  assert.equal(cacheableIcon.headers.get("cache-control"), "public, max-age=3600");
  const unauthenticatedIcon = await fetch(`${origin}/icon-192.png`, { redirect: "manual" });
  assert.equal(unauthenticatedIcon.status, 303);
  assert.equal(unauthenticatedIcon.headers.get("cache-control"), "no-store");

  const publicRequestHeaders = {
    host: "cli-rush.example.test",
    "sec-fetch-site": "same-origin",
    "x-forwarded-for": "192.0.2.10",
    "x-forwarded-proto": "http",
  };
  const publicLogin = await requestOnLocalSocket({
    port,
    pathName: "/login",
    method: "POST",
    headers: { ...publicRequestHeaders, referer: `${publicOrigin}/login`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(publicLogin.status, 303);
  const publicCookie = publicLogin.headers.get("set-cookie");
  assert.match(publicCookie, /^__Host-cli_rush_session=/);
  assert.match(publicCookie, /; Secure/i);
  const publicAuthenticated = await requestOnLocalSocket({
    port,
    headers: { ...publicRequestHeaders, cookie: publicCookie },
  });
  assert.equal(publicAuthenticated.status, 200);

  const publicDestinationWithLocalSource = await requestOnLocalSocket({
    port,
    pathName: "/login",
    method: "POST",
    headers: {
      ...publicRequestHeaders,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(publicDestinationWithLocalSource.status, 403, "The source origin must match the public destination origin.");
  const localDestinationWithPublicSource = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: publicOrigin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(localDestinationWithPublicSource.status, 403, "The source origin must match the local destination origin.");

  const localCookieAtPublicDestination = await requestOnLocalSocket({
    port,
    headers: { ...publicRequestHeaders, origin, cookie },
  });
  assert.equal(localCookieAtPublicDestination.status, 303, "A local cookie must not select the public destination audience.");
  const publicCookieAtLocalDestination = await fetch(`${origin}/`, {
    redirect: "manual",
    headers: { origin: publicOrigin, cookie: publicCookie },
  });
  assert.equal(publicCookieAtLocalDestination.status, 303, "A public cookie must not select the local destination audience.");

  const localToken = cookie.split(";", 1)[0].split("=").slice(1).join("=");
  const replayedAsSecure = await requestOnLocalSocket({
    port,
    headers: { ...publicRequestHeaders, cookie: `__Host-cli_rush_session=${localToken}` },
  });
  assert.equal(replayedAsSecure.status, 303, "A local HTTP session must not be replayable as the public HTTPS cookie.");
  const publicToken = publicCookie.split(";", 1)[0].split("=").slice(1).join("=");
  const replayedAsLocal = await fetch(`${origin}/`, {
    redirect: "manual",
    headers: { cookie: `cli_rush_session=${publicToken}` },
  });
  assert.equal(replayedAsLocal.status, 303, "A public HTTPS session must not be replayable as the local HTTP cookie.");

  const rejectedWrite = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: "[]",
  });
  assert.equal(rejectedWrite.status, 403);

  const emptyStore = await fetch(`${origin}/api/custom-commands`, { headers: { cookie } });
  assert.equal(emptyStore.status, 200);
  assert.equal(emptyStore.headers.get("cache-control"), "no-store");
  assert.equal(emptyStore.headers.get("x-cli-rush-schema-version"), "2");
  const emptyEtag = emptyStore.headers.get("etag");
  assert.match(emptyEtag, /^"custom-[A-Za-z0-9_-]+"$/u);

  const custom = [{
    id: "custom.abcdefgh",
    objective: "Display test data.",
    canonical: "show test",
    explanation: "A test-only\ncommand.",
    topic: "Custom",
    mode: "privileged",
    kind: "verification",
    difficulty: 1,
  }];
  const rejectedControlText = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify([{ ...custom[0], objective: `Unsafe\u202e text` }]),
  });
  assert.equal(rejectedControlText.status, 400);

  const rejectedOversizedBody = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(1024 * 1024) }),
  });
  assert.equal(rejectedOversizedBody.status, 413);
  assert.deepEqual(await rejectedOversizedBody.json(), { error: "The custom command request is too large." });

  const rejectedMalformedBody = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: "{not-json",
  });
  assert.equal(rejectedMalformedBody.status, 400);
  assert.deepEqual(await rejectedMalformedBody.json(), { error: "The request body must be valid JSON." });

  const saved = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify(custom),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("x-cli-rush-schema-version"), "2");
  assert.match(saved.headers.get("etag"), /^"custom-[A-Za-z0-9_-]+"$/u);
  assert.ok(Array.isArray(JSON.parse(await readFile(path.join(data, "custom-commands.json"), "utf8"))), "The on-disk v1 array remains rollback-compatible.");

  const staleWrite = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "if-match": emptyEtag },
    body: JSON.stringify(custom),
  });
  assert.equal(staleWrite.status, 409);

  const restored = await fetch(`${origin}/api/custom-commands`, { headers: { cookie } });
  const restoredCommands = await restored.json();
  assert.deepEqual(restoredCommands.map((item) => item.canonical), ["show test"]);
  assert.equal(restoredCommands[0].explanation, "A test-only\ncommand.");

  const semanticCommands = [{
    schemaVersion: 2,
    status: "active",
    legacy: false,
    deviceProfile: "router-ios-xe",
    id: "custom.semantic1",
    objective: "Inspect the bounded parser status.",
    canonical: "show parser status",
    explanation: "Returns inert simulator evidence.",
    topic: "Custom",
    mode: "privileged",
    kind: "verification",
    difficulty: 1,
    custom: true,
    semantics: {
      helpDescription: "Display the bounded parser status.",
      effect: { type: "read-only", result: "Returns simulator status without changing state." },
      why: "The output confirms the parser is available.",
      progressiveHints: ["Begin with the operational display keyword."],
      revealExplanation: "This command reads simulator state only.",
      tags: ["parser"],
      prerequisites: [],
    },
  }, {
    schemaVersion: 2,
    status: "incomplete",
    legacy: true,
    deviceProfile: null,
    id: "custom.legacy00000001",
    objective: "Old task",
    canonical: "show old-test",
    explanation: "Retained for administrator review.",
    topic: "Custom",
    mode: "privileged",
    kind: "verification",
    difficulty: 1,
    custom: true,
    semantics: {
      helpDescription: "",
      effect: null,
      why: "",
      progressiveHints: [],
      revealExplanation: "",
      tags: [],
      prerequisites: [],
    },
    issues: [{
      code: "LEGACY_INCOMPLETE",
      field: "command",
      message: "Complete the semantic fields before activation.",
      severity: "error",
    }],
    legacySource: { ...custom[0], note: "preserve this source value" },
  }, {
    schemaVersion: 2,
    status: "incomplete",
    legacy: false,
    deviceProfile: "router-ios-xe",
    id: "custom.review0001",
    objective: "Review a rejected version-2 item.",
    canonical: "show parser review",
    explanation: "Retained after validation failed.",
    topic: "Custom",
    mode: "privileged",
    kind: "verification",
    difficulty: 1,
    custom: true,
    semantics: {
      helpDescription: "Display review state.",
      effect: { type: "read-only", result: "Returns inert review state." },
      why: "The administrator can correct it without data loss.",
      progressiveHints: ["Review the parser family."],
      revealExplanation: "This record remains inactive until reviewed again.",
      tags: ["review"],
      prerequisites: [],
    },
    issues: [{
      code: "INCOMPLETE_REVIEW",
      field: "command",
      message: "Review this record before activation.",
      severity: "error",
    }],
  }];
  const semanticSave = await fetch(`${origin}/api/custom-commands`, {
    method: "PUT",
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "if-match": restored.headers.get("etag"),
    },
    body: JSON.stringify(semanticCommands),
  });
  assert.equal(semanticSave.status, 200, await semanticSave.text());
  const semanticReload = await fetch(`${origin}/api/custom-commands`, { headers: { cookie } });
  assert.equal(semanticReload.headers.get("x-cli-rush-schema-version"), "2");
  const reloadedSemanticCommands = await semanticReload.json();
  assert.equal(reloadedSemanticCommands[0].semantics.effect.type, "read-only");
  assert.equal(reloadedSemanticCommands[1].status, "incomplete");
  assert.equal(reloadedSemanticCommands[1].legacySource.note, "preserve this source value");
  assert.equal(reloadedSemanticCommands[2].legacy, false);
  assert.equal(reloadedSemanticCommands[2].semantics.effect.type, "read-only");

  await writeFile(path.join(data, "custom-commands.json"), "{invalid-json");
  const corruptStore = await fetch(`${origin}/api/custom-commands`, { headers: { cookie } });
  assert.equal(corruptStore.status, 500);
  assert.deepEqual(await corruptStore.json(), { error: "Stored custom command data is invalid." });
  await writeFile(path.join(data, "custom-commands.json"), JSON.stringify(custom));

  const registration = await fetch(`${origin}/register`, { headers: { cookie }, redirect: "manual" });
  assert.equal(registration.status, 404);

  const concurrentRejected = await Promise.all(Array.from({ length: 12 }, (_, attempt) =>
    fetch(`${origin}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
        "x-forwarded-for": `192.0.2.${attempt + 20}`,
      },
      body: new URLSearchParams({ username: "admin", password: "wrong" }),
    }).then((response) => response.status)));
  assert.equal(concurrentRejected.filter((status) => status === 401).length, 4, "Only the configured global number of scrypt checks may run together.");
  assert.equal(concurrentRejected.filter((status) => status === 429).length, 8, "Excess concurrent checks must be rejected before scrypt.");
  const fifthRejected = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({ username: "admin", password: "wrong" }),
  });
  assert.equal(fifthRejected.status, 401, "Global saturation alone must not consume a source attempt.");
  const spoofedRateLimitBypass = await fetch(`${origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin, "x-forwarded-for": "198.51.100.20" },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(spoofedRateLimitBypass.status, 429, "Forwarded client addresses from an untrusted peer must not bypass throttling.");

  const logout = await fetch(`${origin}/logout`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, origin },
  });
  assert.equal(logout.status, 303);

  const trustedPort = await freePort();
  const trustedInternalPort = await freePort();
  const trustedOrigin = `http://127.0.0.1:${trustedPort}`;
  const trustedProxyChild = spawn(process.execPath, ["server/auth-server.mjs"], {
    cwd: projectRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(trustedPort),
      CLI_RUSH_INTERNAL_PORT: String(trustedInternalPort),
      CLI_RUSH_DATA_DIR: data,
      CLI_RUSH_USERNAME: "admin",
      CLI_RUSH_COOKIE_SECURE: "true",
      CLI_RUSH_TRUST_PROXY: "true",
      CLI_RUSH_TRUST_PROXY_PEERS: "127.0.0.1,::1",
      CLI_RUSH_PUBLIC_ORIGIN: publicOrigin,
      CLI_RUSH_LOCAL_ORIGIN: trustedOrigin,
      CLI_RUSH_PASSWORD_HASH_FILE: path.join(secrets, "password_hash"),
      CLI_RUSH_SESSION_SECRET_FILE: path.join(secrets, "session_secret"),
    },
  });
  t.after(() => trustedProxyChild.kill("SIGTERM"));
  await waitForHealth(trustedOrigin, trustedProxyChild);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejected = await fetch(`${trustedOrigin}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: trustedOrigin,
        "x-forwarded-for": `203.0.113.${attempt + 1}, 198.51.100.77`,
      },
      body: new URLSearchParams({ username: "admin", password: "wrong" }),
    });
    assert.equal(rejected.status, 401);
  }
  const leftMostSpoof = await fetch(`${trustedOrigin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: trustedOrigin,
      "x-forwarded-for": "192.0.2.88, 198.51.100.77",
    },
    body: new URLSearchParams({ username: "admin", password }),
  });
  assert.equal(leftMostSpoof.status, 429, "The trusted proxy's right-most client address must defeat a spoofed left-most value.");
});
