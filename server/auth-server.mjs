import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.CLI_RUSH_INTERNAL_PORT || 4174);
const dataDir = process.env.CLI_RUSH_DATA_DIR || "/data";
const username = process.env.CLI_RUSH_USERNAME || "admin";
const cookieSecureByDefault = process.env.CLI_RUSH_COOKIE_SECURE !== "false";
const trustProxy = process.env.CLI_RUSH_TRUST_PROXY === "true";
const trustedProxyPeers = new Set(String(process.env.CLI_RUSH_TRUST_PROXY_PEERS || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const configuredMaximumLoginSources = Number(process.env.CLI_RUSH_MAX_LOGIN_SOURCES || 2_048);
const maximumLoginSources = Number.isFinite(configuredMaximumLoginSources)
  ? Math.min(10_000, Math.max(100, Math.floor(configuredMaximumLoginSources)))
  : 2_048;
const configuredMaximumPasswordChecks = Number(process.env.CLI_RUSH_MAX_PASSWORD_CHECKS || 4);
const maximumPasswordChecks = Number.isFinite(configuredMaximumPasswordChecks)
  ? Math.min(32, Math.max(1, Math.floor(configuredMaximumPasswordChecks)))
  : 4;
const configuredOrigin = (name, { requireHttps = false } = {}) => {
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
  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS. Use CLI_RUSH_LOCAL_ORIGIN for explicitly local HTTP access.`);
  }
  return value;
};
const publicOrigin = configuredOrigin("CLI_RUSH_PUBLIC_ORIGIN", { requireHttps: true });
const localOrigin = configuredOrigin("CLI_RUSH_LOCAL_ORIGIN");
const allowedOrigins = new Set([publicOrigin, localOrigin].filter(Boolean));
const configuredOriginsByHost = new Map([...allowedOrigins].map((origin) => {
  const parsed = new URL(origin);
  return [parsed.host.toLowerCase(), parsed.origin];
}));
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
let activePasswordChecks = 0;
const sign = (payload) => createHmac("sha256", sessionSecret).update(payload).digest("base64url");
const issueSession = (audience) => {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    a: audience,
    exp: Date.now() + sessionHours * 3600000,
    n: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
};
const parseCookies = (header = "") => Object.fromEntries(
  header.split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value),
);
const firstHeaderValue = (value = "") => String(value).split(",")[0].trim();
const normalisePeerAddress = (value = "") => String(value).replace(/^::ffff:/u, "");
const proxyHeadersTrusted = (request) => trustProxy && (
  trustedProxyPeers.has(String(request.socket.remoteAddress || "")) ||
  trustedProxyPeers.has(normalisePeerAddress(request.socket.remoteAddress))
);
const inferredOrigin = (request) => {
  const host = firstHeaderValue(request.headers.host).toLowerCase();
  const configured = configuredOriginsByHost.get(host);
  if (configured) return configured;
  const forwardedProtocol = proxyHeadersTrusted(request) ? firstHeaderValue(request.headers["x-forwarded-proto"]) : "";
  const protocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
  return `${protocol}://${host}`;
};
const validDestination = (request) => {
  try {
    const destinationOrigin = inferredOrigin(request);
    return allowedOrigins.size === 0 || allowedOrigins.has(destinationOrigin);
  } catch {
    return false;
  }
};
const requestUsesSecureCookie = (request) => {
  try {
    return new URL(inferredOrigin(request)).protocol === "https:";
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
    return value.u === username
      && value.a === cookieNameFor(request)
      && Number.isFinite(value.exp)
      && value.exp > Date.now();
  } catch {
    return false;
  }
};

const clientIp = (request) => {
  if (!proxyHeadersTrusted(request)) return request.socket.remoteAddress;
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  const normalised = normalisePeerAddress(forwarded);
  return net.isIP(normalised) ? normalised : request.socket.remoteAddress;
};
const pruneAttempts = (now = Date.now()) => {
  for (const [ip, record] of attempts) {
    if (record.resetAt <= now) attempts.delete(ip);
  }
  if (attempts.size < maximumLoginSources) return;
  const oldest = [...attempts.entries()].sort((left, right) => left[1].lastSeen - right[1].lastSeen);
  for (const [ip] of oldest.slice(0, attempts.size - maximumLoginSources + 1)) attempts.delete(ip);
};
const reserveLoginAttempt = (ip) => {
  const now = Date.now();
  pruneAttempts(now);
  const record = attempts.get(ip);
  if (record && record.resetAt > now && record.count >= 5) return false;
  attempts.set(ip, !record || record.resetAt <= now
    ? { count: 1, resetAt: now + 15 * 60000, lastSeen: now }
    : { ...record, count: record.count + 1, lastSeen: now });
  return true;
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
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  ...(cookieSecureByDefault ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  ...extra,
});
const send = (response, status, body, extra = {}) => {
  response.writeHead(status, securityHeaders(extra));
  response.end(body);
};
const publicShellTypes = new Map([
  ["/apple-touch-icon.png", "image/png"],
  ["/favicon.svg", "image/svg+xml"],
  ["/icon-192.png", "image/png"],
  ["/icon-512.png", "image/png"],
  ["/icon-maskable-512.png", "image/png"],
  ["/manifest.webmanifest", "application/manifest+json"],
  ["/offline.html", "text/html"],
]);
const assetTypeByExtension = new Map([
  ["css", "text/css"],
  ["ico", "image/x-icon"],
  ["js", "application/javascript"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["woff2", "font/woff2"],
]);
const responseMime = (headers) => String(headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
const proxyCacheControl = (request, upstreamResponse) => {
  if (!["GET", "HEAD"].includes(request.method || "") || upstreamResponse.statusCode !== 200) return "no-store";
  const pathname = new URL(request.url, "http://localhost").pathname;
  const mime = responseMime(upstreamResponse.headers);
  if (pathname === "/sw.js" && ["application/javascript", "text/javascript"].includes(mime)) return "no-cache";
  const shellMime = publicShellTypes.get(pathname);
  if (shellMime && mime === shellMime) return "public, max-age=3600";
  const asset = pathname.match(/^\/assets\/[A-Za-z0-9._-]+\.([a-z0-9]+)$/u);
  const expectedMime = asset ? assetTypeByExtension.get(asset[1]) : null;
  if (expectedMime && (mime === expectedMime || expectedMime === "application/javascript" && mime === "text/javascript")) {
    return "public, max-age=31536000, immutable";
  }
  return "no-store";
};
const loginPage = (error = "") => `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090b18"><title>Sign in · CLI RUSH</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 82% 12%,rgba(130,144,255,.2),transparent 28rem),radial-gradient(circle at 5% 95%,rgba(255,116,104,.13),transparent 24rem),#090b18;color:#f8f5ff;font:16px/1.5 system-ui}main{width:min(420px,100%);padding:32px;border:1px solid #303653;border-radius:20px;background:#15182d;box-shadow:0 28px 90px rgba(0,0,0,.35)}b{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:11px;background:#ffb45c;color:#0c0e1d}h1{margin:22px 0 8px}p{color:#c4c6da;line-height:1.5}.error{color:#ffb0aa}label{display:block;margin:18px 0 6px;font-size:14px}input{width:100%;min-height:48px;padding:13px;border:1px solid #555d87;border-radius:9px;background:#0c0f20;color:#fff;font:16px/1.3 system-ui}button{width:100%;min-height:48px;margin-top:22px;padding:14px;border:0;border-radius:9px;background:#ffb45c;color:#0c0e1d;font:800 16px/1 system-ui;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid #8290ff;outline-offset:3px}</style><main><b>CR</b><h1>CLI RUSH</h1><p>Private command training arena.</p>${error ? `<p class="error">${error}</p>` : ""}<form method="post" action="/login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><button type="submit">Sign in</button></form></main></html>`;

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
const requestSourceOrigin = (request) => {
  const originHeader = request.headers.origin;
  const source = typeof originHeader === "string" && originHeader !== "null"
    ? originHeader
    : request.headers.referer;
  if (typeof source !== "string") return null;
  try {
    return new URL(source).origin;
  } catch {
    return null;
  }
};
const validOrigin = (request) => {
  const sourceOrigin = requestSourceOrigin(request);
  if (!sourceOrigin) return false;
  try {
    const destinationOrigin = inferredOrigin(request);
    return validDestination(request) && sourceOrigin === destinationOrigin;
  } catch {
    return false;
  }
};

function validateCustomCommands(value) {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Store up to 500 custom commands.");
  const modes = new Set(["user", "privileged", "global", "interface", "router", "line", "vlan", "acl", "dhcp"]);
  const kinds = new Set(["navigation", "verification", "configuration"]);
  const profiles = new Set(["router-ios-xe", "catalyst-l2"]);
  const ids = new Set();
  const isRecord = (candidate) => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  const cleanText = (candidate, fallback, maximum, collapseWhitespace = false, allowLineBreaks = false, required = true) => {
    const raw = candidate === undefined || candidate === null || candidate === "" ? fallback : candidate;
    if (typeof raw !== "string") throw new Error("Custom command text fields must contain text.");
    const forbiddenControls = allowLineBreaks
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
      : /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
    if (forbiddenControls.test(raw)) {
      throw new Error("Custom command text cannot contain control or bidirectional formatting characters.");
    }
    const trimmed = (allowLineBreaks ? raw.replace(/\r\n?/gu, "\n") : raw).trim();
    const clean = collapseWhitespace ? trimmed.replace(/\s+/gu, " ") : trimmed;
    if (required && !clean) throw new Error("Required custom command fields cannot be empty.");
    if (clean.length > maximum) throw new Error(`Custom command text must be ${maximum} characters or fewer.`);
    return clean;
  };
  const cleanOptionalText = (candidate, maximum) => candidate === undefined || candidate === null || candidate === ""
    ? undefined
    : cleanText(candidate, "", maximum, false, true);
  const cleanLegacyText = (candidate, fallback, maximum, collapseWhitespace = false, allowLineBreaks = false) => {
    try {
      return cleanText(candidate, fallback, maximum, collapseWhitespace, allowLineBreaks, false);
    } catch {
      return fallback;
    }
  };
  const cleanList = (candidate, field, maximumItems, maximumLength, minimumItems = 0) => {
    if (!Array.isArray(candidate) || candidate.length < minimumItems || candidate.length > maximumItems) {
      throw new Error(`${field} must contain ${minimumItems ? `between ${minimumItems} and ` : "up to "}${maximumItems} text entries.`);
    }
    return candidate.map((entry) => cleanText(entry, "", maximumLength, false, true));
  };
  const cleanBase = (item, legacy = false) => {
    const mode = typeof item.mode === "string" && modes.has(item.mode) ? item.mode : "privileged";
    const kind = typeof item.kind === "string" && kinds.has(item.kind) ? item.kind : "verification";
    const difficulty = [1, 2, 3].includes(Number(item.difficulty)) ? Number(item.difficulty) : 1;
    const clean = {
      id: cleanText(item.id, "", 100),
      objective: legacy
        ? cleanLegacyText(item.objective, "", 300, false, true)
        : cleanText(item.objective, "", 300, false, true),
      canonical: legacy
        ? cleanLegacyText(item.canonical, "", 256, true)
        : cleanText(item.canonical, "", 256, true),
      explanation: legacy
        ? cleanLegacyText(item.explanation, "", 600, false, true)
        : cleanText(item.explanation, "", 600, false, true),
      topic: legacy
        ? cleanLegacyText(item.topic, "Custom", 80)
        : cleanText(item.topic, "Custom", 80),
      mode,
      kind,
      difficulty,
      custom: true,
    };
    if (!/^custom\.[a-zA-Z0-9_-]{8,90}$/.test(clean.id) || ids.has(clean.id)) {
      throw new Error("Custom command IDs must be unique and valid.");
    }
    if (!legacy && (!clean.objective || !clean.canonical || !clean.explanation)) {
      throw new Error("Objective, command and explanation are required.");
    }
    if (!legacy && (mode !== item.mode || kind !== item.kind)) throw new Error("Unsupported mode or command type.");
    if (!legacy && difficulty !== item.difficulty) throw new Error("Difficulty must be 1, 2 or 3.");
    if (!legacy && clean.canonical && !/^[\p{L}\p{N}][\p{L}\p{N} .,:\/_@#'%+*=-]*$/u.test(clean.canonical)) {
      throw new Error("Commands may contain only the bounded IOS-style grammar characters.");
    }
    ids.add(clean.id);
    return clean;
  };
  const cleanEffect = (candidate) => {
    if (!isRecord(candidate) || !["read-only", "state-change"].includes(candidate.type)) {
      throw new Error("Every active custom command requires a read-only or state-change effect.");
    }
    return candidate.type === "read-only"
      ? { type: "read-only", result: cleanText(candidate.result, "", 600, false, true) }
      : { type: "state-change", description: cleanText(candidate.description, "", 600, false, true) };
  };
  const cleanSemantics = (candidate, kind) => {
    if (!isRecord(candidate)) throw new Error("Every active custom command requires semantic teaching data.");
    const effect = cleanEffect(candidate.effect);
    if (effect.type === "read-only" && kind !== "verification") {
      throw new Error("Read-only custom commands must use the verification type.");
    }
    if (effect.type === "state-change" && kind === "verification") {
      throw new Error("State-changing custom commands must use configuration or navigation type.");
    }
    const verification = cleanOptionalText(candidate.verification, 500);
    if (effect.type === "state-change" && !verification) {
      throw new Error("State-changing custom commands require verification metadata.");
    }
    const undo = cleanOptionalText(candidate.undo, 500);
    return {
      helpDescription: cleanText(candidate.helpDescription, "", 240, false, true),
      effect,
      why: cleanText(candidate.why, "", 600, false, true),
      progressiveHints: cleanList(candidate.progressiveHints, "Progressive hints", 3, 300, 1),
      revealExplanation: cleanText(candidate.revealExplanation, "", 600, false, true),
      ...(verification ? { verification } : {}),
      ...(undo ? { undo } : {}),
      tags: cleanList(candidate.tags, "Tags", 12, 40),
      prerequisites: cleanList(candidate.prerequisites, "Prerequisites", 20, 100),
    };
  };
  const cleanIssue = (candidate) => {
    if (!isRecord(candidate)) throw new Error("Legacy review issues must be objects.");
    const severity = candidate.severity === "warning" ? "warning" : "error";
    return {
      code: cleanText(candidate.code, "LEGACY_INCOMPLETE", 80),
      field: cleanText(candidate.field, "command", 120),
      message: cleanText(candidate.message, "Legacy command requires review.", 600, false, true),
      severity,
    };
  };
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Every command must be an object.");
    if (item.schemaVersion !== 2) return cleanBase(item);
    if (item.status === "active" && item.legacy === false) {
      const clean = cleanBase(item);
      if (!profiles.has(item.deviceProfile)) throw new Error("Unsupported custom command device profile.");
      return {
        schemaVersion: 2,
        status: "active",
        legacy: false,
        deviceProfile: item.deviceProfile,
        ...clean,
        semantics: cleanSemantics(item.semantics, clean.kind),
      };
    }
    if (item.status === "incomplete"
      && typeof item.legacy === "boolean"
      && (item.deviceProfile === null || profiles.has(item.deviceProfile))) {
      const clean = cleanBase(item, true);
      if (!isRecord(item.semantics)) throw new Error("Legacy custom command semantics must be an object.");
      const semantics = {
        helpDescription: cleanText(item.semantics.helpDescription, "", 240, false, true, false),
        effect: item.semantics.effect === null ? null : cleanEffect(item.semantics.effect),
        why: cleanText(item.semantics.why, "", 600, false, true, false),
        progressiveHints: cleanList(item.semantics.progressiveHints, "Progressive hints", 3, 300),
        revealExplanation: cleanText(item.semantics.revealExplanation, "", 600, false, true, false),
        tags: cleanList(item.semantics.tags, "Tags", 12, 40),
        prerequisites: cleanList(item.semantics.prerequisites, "Prerequisites", 20, 100),
      };
      const verification = cleanOptionalText(item.semantics.verification, 500);
      const undo = cleanOptionalText(item.semantics.undo, 500);
      return {
        schemaVersion: 2,
        status: "incomplete",
        legacy: item.legacy,
        deviceProfile: item.deviceProfile,
        ...clean,
        semantics: {
          ...semantics,
          ...(verification ? { verification } : {}),
          ...(undo ? { undo } : {}),
        },
        issues: Array.isArray(item.issues) && item.issues.length <= 40
          ? item.issues.map(cleanIssue)
          : [cleanIssue({ message: "Legacy command requires review." })],
        legacySource: item.legacySource,
      };
    }
    throw new Error("Unsupported custom command schema state.");
  });
}

const customCommandsEtag = (commands) => `"custom-${createHash("sha256")
  .update(JSON.stringify(commands)).digest("base64url")}"`;
const readCustomCommands = async () => {
  const body = await readFile(customCommandsPath, "utf8").catch((error) => (
    error.code === "ENOENT" ? "[]" : Promise.reject(error)
  ));
  try {
    return validateCustomCommands(JSON.parse(body));
  } catch {
    const error = new Error("Stored custom command data is invalid.");
    error.code = "STORE_INVALID";
    throw error;
  }
};
let customCommandWriteQueue = Promise.resolve();
const serialiseCustomCommandWrite = (operation) => {
  const result = customCommandWriteQueue.then(operation, operation);
  customCommandWriteQueue = result.then(() => undefined, () => undefined);
  return result;
};

async function api(request, response, path) {
  if (path === "/api/session" && request.method === "GET") {
    send(response, 200, JSON.stringify({ authenticated: true, username }), { "content-type": "application/json" });
    return true;
  }
  if (path !== "/api/custom-commands") return false;
  if (request.method === "GET") {
    try {
      const commands = await readCustomCommands();
      send(response, 200, JSON.stringify(commands), {
        "content-type": "application/json",
        etag: customCommandsEtag(commands),
        "x-cli-rush-schema-version": "2",
      });
    } catch (error) {
      const message = error.code === "STORE_INVALID"
        ? error.message
        : "Custom command data could not be read.";
      send(response, 500, JSON.stringify({ error: message }), { "content-type": "application/json" });
    }
    return true;
  }
  if (request.method === "PUT") {
    if (!validOrigin(request) || !String(request.headers["content-type"] || "").startsWith("application/json")) {
      send(response, 403, JSON.stringify({ error: "Invalid request origin." }), { "content-type": "application/json" });
      return true;
    }
    try {
      const clean = validateCustomCommands(JSON.parse((await readBody(request)).toString("utf8")));
      const saved = await serialiseCustomCommandWrite(async () => {
        const current = await readCustomCommands();
        const suppliedEtag = request.headers["if-match"];
        if (typeof suppliedEtag === "string" && suppliedEtag !== customCommandsEtag(current)) {
          const error = new Error("Custom commands changed in another session. Reload before saving again.");
          error.code = "REVISION_CONFLICT";
          throw error;
        }
        const temporary = `${customCommandsPath}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, customCommandsPath);
        return clean;
      });
      send(response, 200, JSON.stringify({ saved: saved.length }), {
        "content-type": "application/json",
        etag: customCommandsEtag(saved),
        "x-cli-rush-schema-version": "2",
      });
    } catch (error) {
      const bodyTooLarge = error.message === "BODY_TOO_LARGE";
      const revisionConflict = error.code === "REVISION_CONFLICT";
      const storageFailure = error.code === "STORE_INVALID" || (/^[A-Z][A-Z0-9_]+$/u.test(String(error.code || "")) && !revisionConflict);
      const status = bodyTooLarge ? 413 : revisionConflict ? 409 : storageFailure ? 500 : 400;
      const message = bodyTooLarge
        ? "The custom command request is too large."
        : revisionConflict || error.code === "STORE_INVALID"
          ? error.message
          : storageFailure
            ? "Custom commands could not be saved."
            : error instanceof SyntaxError
              ? "The request body must be valid JSON."
              : error.message;
      send(response, status, JSON.stringify({ error: message }), { "content-type": "application/json" });
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
    const responseHeaders = {
      ...upstreamResponse.headers,
      ...securityHeaders({ "cache-control": proxyCacheControl(request, upstreamResponse) }),
    };
    delete responseHeaders["set-cookie"];
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => send(response, 503, "Application is starting. Retry shortly."));
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  const requestTarget = String(request.url || "");
  if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
    send(response, 400, "The HTTP request target is invalid.", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  let url;
  try {
    url = new URL(requestTarget, "http://localhost");
  } catch {
    send(response, 400, "The HTTP request target is invalid.", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
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
  if (!validDestination(request)) {
    send(response, 421, "The request host is not configured for CLI RUSH.", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  if (path === "/login") {
    if (request.method === "GET") {
      send(response, authenticated(request) ? 303 : 200, authenticated(request) ? "" : loginPage(), authenticated(request)
        ? { location: "/" }
        : { "content-type": "text/html; charset=utf-8" });
      return;
    }
    if (!validOrigin(request)) {
      console.warn("Rejected login source; request values suppressed.", JSON.stringify({
        originPresent: Boolean(requestSourceOrigin(request)),
        hostPresent: Boolean(request.headers.host),
        forwardedProtocolPresent: Boolean(firstHeaderValue(request.headers["x-forwarded-proto"])),
      }));
      send(response, 403, loginPage("The login request did not come from this site."), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    if (request.method !== "POST") {
      send(response, 405, "Method not allowed", { allow: "GET, POST" });
      return;
    }
    const ip = clientIp(request);
    let form;
    try {
      form = new URLSearchParams((await readBody(request, 4096)).toString("utf8"));
    } catch (error) {
      send(response, error.message === "BODY_TOO_LARGE" ? 413 : 400, loginPage("The login request was not valid."), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    if (activePasswordChecks >= maximumPasswordChecks) {
      send(response, 429, loginPage("Too many sign-in checks are already running. Try again shortly."), { "content-type": "text/html; charset=utf-8", "retry-after": "1" });
      return;
    }
    if (!reserveLoginAttempt(ip)) {
      send(response, 429, loginPage("Too many attempts. Try again later."), { "content-type": "text/html; charset=utf-8", "retry-after": "900" });
      return;
    }
    activePasswordChecks += 1;
    let passwordValid;
    try {
      passwordValid = await verifyPassword(form.get("password") || "");
    } finally {
      activePasswordChecks = Math.max(0, activePasswordChecks - 1);
    }
    const valid = safeTextEqual(form.get("username") || "", username) && passwordValid;
    if (!valid) {
      send(response, 401, loginPage("The username or password is incorrect."), { "content-type": "text/html; charset=utf-8" });
      return;
    }
    attempts.delete(ip);
    const secure = requestUsesSecureCookie(request);
    const cookieName = cookieNameFor(request);
    const cookie = `${cookieName}=${issueSession(cookieName)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours * 3600}${secure ? "; Secure" : ""}`;
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
