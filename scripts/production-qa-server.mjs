import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as proxyRequest } from "node:http";
import { extname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const publicPort = Number.parseInt(process.env.CLI_RUSH_QA_SERVER_PORT ?? "4174", 10);
const upstreamPort = Number.parseInt(process.env.CLI_RUSH_QA_UPSTREAM_PORT ?? "4175", 10);
const clientRoot = resolve("dist/client");
const clientPrefix = `${clientRoot}${sep}`;
const vinextCli = resolve("node_modules/vinext/dist/cli.js");
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

const upstream = spawn(process.execPath, [vinextCli, "start", "--port", String(upstreamPort)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});

const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (upstream.exitCode !== null) throw new Error(`vinext exited before it became ready (${upstream.exitCode}).`);
  try {
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await delay(250);
}
if (!ready) {
  upstream.kill();
  throw new Error(`vinext did not become ready on port ${upstreamPort}.`);
}

const localAsset = async (rawUrl) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl ?? "/", "http://qa.local").pathname);
  } catch {
    return null;
  }
  const candidate = resolve(clientRoot, `.${pathname}`);
  if (candidate !== clientRoot && !candidate.startsWith(clientPrefix)) return null;
  try {
    const details = await stat(candidate);
    return details.isFile() ? { candidate, size: details.size } : null;
  } catch {
    return null;
  }
};

const server = createServer(async (request, response) => {
  if (request.method === "GET" || request.method === "HEAD") {
    const asset = await localAsset(request.url);
    if (asset) {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": asset.size,
        "Content-Type": mimeTypes.get(extname(asset.candidate).toLowerCase()) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(asset.candidate).pipe(response);
      return;
    }
  }

  const forwarded = proxyRequest({
    hostname: "127.0.0.1",
    port: upstreamPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}` },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  forwarded.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`QA upstream failed: ${error.message}`);
  });
  request.pipe(forwarded);
});

const close = () => {
  server.close();
  if (upstream.exitCode === null) upstream.kill();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
process.once("exit", () => {
  if (upstream.exitCode === null) upstream.kill();
});

server.listen(publicPort, "127.0.0.1", () => {
  console.log(`CLI RUSH production QA server: http://127.0.0.1:${publicPort}`);
});
