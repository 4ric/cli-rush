import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /<html[^>]+lang=["']en-GB["']/i);
  assert.match(html, /<link(?=[^>]*rel=["']manifest["'])(?=[^>]*href=["']\/manifest\.webmanifest["'])/i);
});

const source = async (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("PWA metadata, icons and offline policy are installable without caching private routes", async () => {
  const { default: createManifest } = await import(new URL("../app/manifest.ts", import.meta.url));
  const manifest = createManifest();
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "en-GB");
  assert.ok(manifest.icons?.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));

  for (const [name, expected] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512]]) {
    const png = await readFile(new URL(`../public/${name}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), expected);
    assert.equal(png.readUInt32BE(20), expected);
  }

  const worker = await source("public/sw.js");
  const layout = await source("app/layout.tsx");
  assert.match(layout, /rel="manifest"[^>]+crossOrigin="use-credentials"/u);
  assert.match(worker, /OFFLINE_PAGE\s*=\s*["']\/offline\.html["']/u);
  assert.match(worker, /url\.pathname\.startsWith\(["']\/api\/["']\)/u);
  assert.match(worker, /url\.pathname\s*===\s*["']\/login["']/u);
  assert.match(worker, /url\.pathname\s*===\s*["']\/logout["']/u);
  assert.match(worker, /url\.pathname\s*===\s*["']\/healthz["']/u);
  assert.match(worker, /!response\.redirected/u);
  assert.match(worker, /responseUrl\.href\s*===\s*request\.url/u);
  assert.match(worker, /STATIC_CONTENT_TYPES\[extension\]\?\.includes\(contentType\)/u);
  assert.match(worker, /\\bno-store\\b/u);
  assert.match(worker, /redirect:\s*["']error["']/u);
  assert.match(worker, /mayCacheSafeShellResponse/u);
  assert.doesNotMatch(worker, /cache\.addAll\(SAFE_SHELL\)/u);
  assert.doesNotMatch(worker, /caches\.match\(request\).*request\.mode\s*===\s*["']navigate["']/su);
});

test("service worker rejects redirected, HTML and no-store responses from the static cache", async () => {
  const worker = await source("public/sw.js");
  const context = {
    URL,
    caches: {},
    fetch() {},
    self: {
      clients: {},
      location: { origin: "https://cli-rush.example" },
      addEventListener() {},
    },
  };
  runInNewContext(`${worker}\nglobalThis.checkStaticCache = mayCacheStaticResponse; globalThis.checkSafeShellCache = mayCacheSafeShellResponse;`, context);
  const request = { url: "https://cli-rush.example/assets/app.js" };
  const response = ({
    contentType = "application/javascript",
    cacheControl = "public, max-age=31536000",
    redirected = false,
    url = request.url,
  } = {}) => ({
    ok: true,
    redirected,
    type: "basic",
    url,
    headers: {
      get(name) {
        if (name === "content-type") return contentType;
        if (name === "cache-control") return cacheControl;
        return null;
      },
    },
  });

  assert.equal(context.checkStaticCache(request, response()), true);
  assert.equal(context.checkStaticCache(request, response({ redirected: true })), false);
  assert.equal(context.checkStaticCache(request, response({ contentType: "text/html" })), false);
  assert.equal(context.checkStaticCache(request, response({ cacheControl: "private, no-store" })), false);
  assert.equal(context.checkStaticCache(request, response({ url: "https://cli-rush.example/login" })), false);

  const offlineRequest = { url: "https://cli-rush.example/offline.html" };
  assert.equal(context.checkSafeShellCache("/offline.html", response({
    contentType: "text/html",
    cacheControl: "public, max-age=3600",
    url: offlineRequest.url,
  })), true);
  assert.equal(context.checkSafeShellCache("/offline.html", response({
    contentType: "text/html",
    cacheControl: "public, max-age=3600",
    redirected: true,
    url: offlineRequest.url,
  })), false);
  assert.equal(context.checkSafeShellCache("/icon-192.png", response({
    contentType: "text/html",
    cacheControl: "public, max-age=3600",
    url: "https://cli-rush.example/icon-192.png",
  })), false);
});

test("active workspace keeps input local, restores routes and responds to the visual viewport", async () => {
  const page = await source("app/page.tsx");
  const styles = await source("app/globals.css");
  assert.match(page, /const TerminalCommandInput = memo\(forwardRef/u);
  assert.match(page, /const \[draft, setDraft\] = useState\(initialValue\)/u);
  assert.match(page, /window\.visualViewport/u);
  assert.doesNotMatch(page, /visualViewport\?\.addEventListener\(["']scroll["']/u);
  assert.match(page, /window\.addEventListener\(["']popstate["']/u);
  assert.match(page, /window\.addEventListener\(["']pagehide["']/u);
  assert.match(page, /restoreDeviceState\(candidate\.device\)/u);
  assert.match(page, /restoreDeviceState\(saved\?\.device, restoredScheduler\?\.profileId\)/u);
  assert.match(page, /queue: queue\.slice\(0, 512\)/u);
  assert.match(page, /redactCommandForDisplay/u);
  assert.match(page, /handleCliControl/u);
  assert.match(page, /Ctrl\+Shift\+6/u);
  assert.match(page, /terminalTouchControls/u);
  assert.match(page, /className="terminal-shortcuts"[^>]+role="toolbar"/u);
  assert.match(page, /executeCliCommand\(device, value, catalogue\)/u);
  assert.match(page, /executionSatisfiesLearningObjective\(item, device, execution, catalogue\)/u);
  assert.doesNotMatch(page, /validateOperational/u);
  assert.match(page, /completeCliInput\(value, device\.context, catalogue, device\.profileId\)/u);
  assert.match(page, /cliHelp\(value, device\.context, catalogue, device\.profileId\)/u);
  assert.match(page, /reviewForRoundOutcome\(id, old\?\.review, "skipped"\)/u);
  assert.match(page, /customStoreUnavailable \? "Docker data unavailable"/u);
  assert.match(page, />Skip objective</u);
  assert.match(page, /createNavigationScheduler/u);
  assert.match(page, /restoreNavigationScheduler/u);
  assert.match(page, /const lesson = goodToKnowLessons\[session\.stepIndex\]/u);
  assert.match(page, /goodToKnowDistinctions\.map/u);
  assert.match(page, /completeIpv4ScenarioInput/u);
  assert.match(page, /restoreIpv4ScenarioCheckpoint\(scenario\)/u);
  assert.match(page, /restoreDeviceBuildCheckpoint\(state\)/u);
  assert.match(page, /getIpv4ScenarioCliHelp/u);
  assert.doesNotMatch(page, /scenarioAssistanceCatalogue/u);
  assert.match(page, /recordCommandAssistance\(item\.id, "guided"\)/u);
  assert.match(page, /title=["']Highlight to copy["']/u);
  assert.doesNotMatch(page, /role=["']log["']/u);
  assert.match(page, /const visibleLines = lines\.slice\(-60\)/u);

  assert.match(styles, /--visual-viewport-height:100dvh/u);
  assert.match(styles, /env\(safe-area-inset-bottom/u);
  assert.match(styles, /@media\(display-mode:standalone\)/u);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/u);
  assert.match(styles, /\.practice-workspace\{[^}]*grid-template-columns:clamp\(360px,29vw,420px\)/su);
  assert.match(styles, /button,input,textarea,select,summary\{font-size:16px\}/u);
  assert.match(styles, /\.task-kicker,\.current-context,[^{}]+\{font-size:14px\}/u);
  assert.match(styles, /\.sound-control\{display:grid!important/u);
  assert.match(styles, /\.screen-navigation/u);
  assert.match(styles, /\.shell button,\.shell summary\{min-width:44px;min-height:44px\}/u);
  assert.match(styles, /\.terminal form>\.terminal-shortcuts/u);
  assert.match(styles, /\.grid-bg\{position:absolute;[^}]*mask-image:none/u);
  assert.match(styles, /data-keyboard-open=["']true["'][^{}]+\.task-panel\{display:none\}/su);
});
