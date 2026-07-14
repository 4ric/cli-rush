const CACHE = "cli-rush-static-v3";
const OFFLINE_PAGE = "/offline.html";
const SAFE_SHELL = [OFFLINE_PAGE, "/favicon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"];
const SAFE_SHELL_CONTENT_TYPES = {
  "/apple-touch-icon.png": "image/png",
  "/favicon.svg": "image/svg+xml",
  "/icon-192.png": "image/png",
  "/icon-512.png": "image/png",
  "/icon-maskable-512.png": "image/png",
  [OFFLINE_PAGE]: "text/html",
};
const STATIC_CONTENT_TYPES = {
  css: ["text/css"],
  ico: ["image/x-icon", "image/vnd.microsoft.icon"],
  js: ["application/javascript", "text/javascript"],
  png: ["image/png"],
  svg: ["image/svg+xml"],
  woff2: ["font/woff2", "application/font-woff2"],
};

const mayCacheStaticResponse = (request, response) => {
  const extension = new URL(request.url).pathname.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase();
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const cacheControl = response.headers.get("cache-control") ?? "";
  const responseUrl = response.url ? new URL(response.url) : null;
  return Boolean(
    extension
      && STATIC_CONTENT_TYPES[extension]?.includes(contentType)
      && response.ok
      && !response.redirected
      && response.type === "basic"
      && responseUrl?.origin === self.location.origin
      && responseUrl.href === request.url
      && !/\bno-store\b/iu.test(cacheControl),
  );
};

const mayCacheSafeShellResponse = (pathname, response) => {
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const cacheControl = response.headers.get("cache-control") ?? "";
  const expectedUrl = new URL(pathname, self.location.origin).href;
  return Boolean(
    SAFE_SHELL_CONTENT_TYPES[pathname] === contentType
      && response.ok
      && !response.redirected
      && response.type === "basic"
      && response.url === expectedUrl
      && !/\bno-store\b/iu.test(cacheControl),
  );
};

const installSafeShell = async () => {
  const cache = await caches.open(CACHE);
  await Promise.all(SAFE_SHELL.map(async (pathname) => {
    const request = new Request(new URL(pathname, self.location.origin).href, {
      cache: "no-cache",
      credentials: "same-origin",
      redirect: "error",
    });
    const response = await fetch(request);
    if (!mayCacheSafeShellResponse(pathname, response)) {
      throw new Error(`Refused unsafe offline shell response for ${pathname}`);
    }
    await cache.put(request, response);
  }));
};

self.addEventListener("install", (event) => {
  event.waitUntil(installSafeShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/healthz" || url.pathname === "/login" || url.pathname === "/logout" || request.headers.has("authorization")) return;
  if (url.pathname === "/sw.js") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_PAGE)) ?? new Response("CLI RUSH cannot reach the local service. Reconnect and try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
    return;
  }
  if (!/\.(?:css|js|svg|png|ico|woff2)$/u.test(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
    // A reverse proxy may redirect an unauthenticated asset request to an HTML
    // login page. Never persist that response under the original asset URL.
    if (mayCacheStaticResponse(request, response)) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
