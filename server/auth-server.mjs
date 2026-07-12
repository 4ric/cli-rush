import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.CLI_RUSH_INTERNAL_PORT || 4174);
const dataDir = process.env.CLI_RUSH_DATA_DIR || "/data";
const username = process.env.CLI_RUSH_USERNAME || "ignas";
const cookieSecureByDefault = process.env.CLI_RUSH_COOKIE_SECURE !== "false";
const trustProxy = process.env.CLI_RUSH_TRUST_PROXY === "true";
const configuredOrigin = (name) => {
  const value = process.env[name]?.replace(/\/$/, "") || null;
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a complete HTTP or HTTPS origin.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value) {
    throw new Error(`${name} must contain only the scheme, hostname and optional port.`);
  }
  return value;
};
const publicOrigin = configuredOrigin("CLI_RUSH_PUBLIC_ORIGIN");
const localOrigin = configuredOrigin("CLI_RUSH_LOCAL_ORIGIN");
const allowedOrigins = new Set([publicOrigin, localOrigin].filter(Boolean));
const sessionHours = Math.min(168, Math.max(1, Number(process.env.CLI_RUSH_SESSION_HOURS || 12)));
const customCommandsPath = `${dataDir}/custom-commands.json`;
const secureCookieName = "__Host-cli_rush_session";
const localCookieName = "cli_rush_session";

async function secret(directName, fileName) {
  if (process.env[fileName]) return (await readFile(process.env[fileName], "utf8")).trim();
  return process.env[directName]?.trim() || "";
}

const passwordHash = await secret("CLI_RUSH_PASSWORD_HASH", "CLI_RUSH_PASSWORD_HASH_FILE");
const sessionSecret = await secret("CLI_RUSH_SESSION_SECRET", "CLI_RUSH_SESSION_SECRET_FILE");
if (!passwordHash.startsWith("scrypt$") || sessionSecret.length < 43) {
  console.error("Password hash or session secret is missing. Run npm run init:secrets and mount the generated files.");
  process.exit(1);
}
await mkdir(dataDir, { recursive: true });

const app = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "start", "-p", String(upstreamPort), "-H", "127.0.0.1"],
  { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, PORT: String(upstreamPort) } },
);
app.on("exit", (code) => {
  console.error(`Internal application server stopped with code ${code}.`);
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  app.kill(signal);
  process.exit(0);
});

const attempts = new Map();
const sign = (payload) => createHmac("sha256", sessionSecret).update(payload).digest("base64url");
const issueSession = () => {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + sessionHours * 3600000,
    n: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
};
const parseCookies = (header = "") => Object.fromEntries(
  header.split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value),
);
const firstHeaderValue = (value = "") => String(value).split(",")[0].trim();
const inferredOrigin = (request) => {
  const forwardedProtocol = trustProxy ? firstHeaderValue(request.headers["x-forwarded-proto"]) : "";
  const protocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
  return `${protocol}://${request.headers.host}`;
};
const requestUsesSecureCookie = (request) => {
  const origin = request.headers.origin || inferredOrigin(request);
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return cookieSecureByDefault;
  }
};
const cookieNameFor = (request) => requestUsesSecureCookie(request) ? secureCookieName : localCookieName;
const authenticated = (request) => {
  const token = parseCookies(request.headers.cookie)[cookieNameFor(request)];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value.u === username && Number.isFinite(value.exp) && value.exp > Date.now();
  } catch {
    return false;
  }
};

const clientIp = (request) => trustProxy
  ? String(request.headers["x-forwarded-for"] || "").split(",")[0].trim() || request.socket.remoteAddress
  : request.socket.remoteAddress;
const blocked = (ip) => {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || record.resetAt <= now) {
    attempts.delete(ip);
    return false;
  }
  return record.count >= 5;
};
const failedLogin = (ip) => {
  const now = Date.now();
  const record = attempts.get(ip);
  attempts.set(ip, !record || record.resetAt <= now
    ? { count: 1, resetAt: now + 15 * 60000 }
    : { ...record, count: record.count + 1 });
};

async function verifyPassword(password) {
  const [kind, n, r, p, saltText, hashText] = passwordHash.split("$");
  if (kind !== "scrypt" || !saltText || !hashText) return false;
  const stored = Buffer.from(hashText, "base64url");
  const derived = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), stored.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  }));
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

const safeTextEqual = (left, right) => {
  const leftHash = createHmac("sha256", sessionSecret).update(String(left)).digest();
  const rightHash = createHmac("sha256", sessionSecret).update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
};

const securityHeaders = (extra = {}) => ({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  ...(cookieSecureByDefault ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  ...extra,
});
const send = (response, status, body, extra = {}) => {
  response.writeHead(status, securityHeaders(extra));
  response.end(body);
};
const loginPage = (error = "") => `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in · CLI RUSH</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07110f;color:#edf7f2;font-family:system-ui}main{width:min(420px,calc(100% - 32px));padding:32px;border:1px solid #294038;background:#0d1a17}b{display:inline-grid;place-items:center;width:42px;height:42px;background:#d9ff57;color:#07110f}h1{margin:22px 0 8px}p{color:#8ba198;line-height:1.5}.error{color:#ff8a82}label{display:block;margin:18px 0 6px;font-size:13px}input{width:100%;padding:13px;border:1px solid #385047;background:#07110f;color:#fff}button{width:100%;margin-top:22px;padding:14px;border:0;background:#d9ff57;color:#07110f;font-weight:800;cursor:pointer}</style><main><b>CR</b><h1>CLI RUSH</h1><p>Private command training arena.</p>${error ? `<p class="error">${error}</p>` : ""}<form method="post" action="/login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><button type="submit">Sign in</button></form></main></html>`;

const readBody = async (request, limit = 1024 * 1024) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
const validOrigin = (request) => {
  const origin = request.headers.origin;
  return typeof origin === "string" && (allowedOrigins.size > 0
    ? allowedOrigins.has(origin)
    : origin === inferredOrigin(request));
};

function validateCustomCommands(value) {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Store up to 500 custom commands.");
  const modes = new Set(["user", "privileged", "global", "interface", "router", "line", "vlan", "acl", "dhcp"]);
  const kinds = new Set(["navigation", "verification", "configuration"]);
  const ids = new Set();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Every command must be an object.");
    const clean = {
      id: String(item.id || "").slice(0, 100),
      objective: String(item.objective || "").trim().slice(0, 300),
      canonical: String(item.canonical || "").trim().replace(/\s+/g, " ").slice(0, 256),
      explanation: String(item.explanation || "").trim().slice(0, 600),
      topic: String(item.topic || "Custom").trim().slice(0, 80),
      mode: String(item.mode || "privileged"),
      kind: String(item.kind || "verification"),
      difficulty: Math.min(3, Math.max(1, Number(item.difficulty) || 1)),
      custom: true,
    };
    if (!/^custom\.[a-zA-Z0-9_-]{8,90}$/.test(clean.id) || ids.has(clean.id)) {
      throw new Error("Custom command IDs must be unique and valid.");
    }
    if (!clean.objective || !clean.canonical || !clean.explanation) {
      throw new Error("Objective, command and explanation are required.");
    }
    if (!modes.has(clean.mode) || !kinds.has(clean.kind)) throw new Error("Unsupported mode or command type.");
    if (/[\u0000-\u001f\u007f]/.test(clean.canonical)) throw new Error("Commands cannot contain control characters.");
    ids.add(clean.id);
    return clean;
  });
}

async function api(request, response, path) {
  if (path === "/api/session" && request.method === "GET") {
    send(response, 200, JSON.stringify({ authenticated: true, username }), { "content-type": "application/json" });
    return true;
  }
  if (path !== "/api/custom-commands") return false;
  if (request.method === "GET") {
    const body = await readFile(customCommandsPath, "utf8").catch((error) => (
      error.code === "ENOENT" ? "[]" : Promise.reject(error)
    ));
    send(response, 200, body, { "content-type": "application/json" });
    return true;
  }
  if (request.method === "PUT") {
    if (!validOrigin(request) || !String(request.headers["content-type"] || "").startsWith("application/json")) {
      send(response, 403, JSON.stringify({ error: "Invalid request origin." }), { "content-type": "application/json" });
      return true;
    }
    try {
      const clean = validateCustomCommands(JSON.parse((await readBody(request)).toString("utf8")));
      const temporary = `${customCommandsPath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, customCommandsPath);
      send(response, 200, JSON.stringify({ saved: clean.length }), { "content-type": "application/json" });
    } catch (error) {
      send(response, error.message === "BODY_TOO_LARGE" ? 413 : 400, JSON.stringify({ error: error.message }), { "content-type": "application/json" });
    }
    return true;
  }
  send(response, 405, "Method not allowed", { allow: "GET, PUT" });
  return true;
}

function proxy(request, response) {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: upstreamPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}` },
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers, ...securityHeaders() };
    delete responseHeaders["set-cookie"];
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => send(response, 503, "Application is starting. Retry shortly."));
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname;
  if (path === "/healthz") {
    let ready = app.exitCode === null;
    if (ready) {
      try {
        const upstream = await fetch(`http://127.0.0.1:${upstreamPort}/`, { signal: AbortSignal.timeout(1000) });
        ready = upstream.status < 500;
      } catch {
        ready = false;
      }
    }
    send(response, ready ? 200 : 503, ready ? "ok" : "unavailable", { "content-type": "text/plain" });
    return;
  }
  if (path === "/login") {
    if (request.method === "GET") {
      send(response, authenticated(request) ? 303 : 200, authenticated(request) ? "" : loginPage(), authenticated(request)
        ? { location: "/" }
        : { "content-type": "text/html; charset=utf-8" });
      return;
    }
    if (!validOrigin(request) || !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"] || ""))) {
      send(response, 403, loginPage("The login request did not come from this site."), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    const ip = clientIp(request);
    if (request.method !== "POST" || blocked(ip)) {
      send(response, 429, loginPage("Too many attempts. Try again later."), { "content-type": "text/html; charset=utf-8", "retry-after": "900" });
      return;
    }
    const form = new URLSearchParams((await readBody(request, 4096)).toString("utf8"));
    const passwordValid = await verifyPassword(form.get("password") || "");
    const valid = safeTextEqual(form.get("username") || "", username) && passwordValid;
    if (!valid) {
      failedLogin(ip);
      send(response, 401, loginPage("The username or password is incorrect."), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    attempts.delete(ip);
    const secure = requestUsesSecureCookie(request);
    const cookie = `${cookieNameFor(request)}=${issueSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours * 3600}${secure ? "; Secure" : ""}`;
    send(response, 303, "", { location: "/", "set-cookie": cookie });
    return;
  }
  if (path === "/logout" && request.method === "POST") {
    if (!validOrigin(request)) {
      send(response, 403, "Invalid request origin.");
      return;
    }
    const secure = requestUsesSecureCookie(request);
    send(response, 303, "", { location: "/login", "set-cookie": `${cookieNameFor(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}` });
    return;
  }
  if (!authenticated(request)) {
    send(response, 303, "", { location: "/login" });
    return;
  }
  if (path.startsWith("/api/") && await api(request, response, path)) return;
  proxy(request, response);
});
server.listen(port, "0.0.0.0", () => console.log(`CLI RUSH listening on port ${port}.`));
