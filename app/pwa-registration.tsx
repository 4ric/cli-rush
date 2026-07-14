"use client";

import { useEffect, useState } from "react";

export function PwaRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const wentOnline = () => setOnline(true);
    const wentOffline = () => setOnline(false);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    const onControllerChange = () => window.location.reload();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((next) => {
        if (next.waiting) setWaiting(next.waiting);
        next.addEventListener("updatefound", () => {
          const worker = next.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
          });
        });
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener("online", wentOnline);
      window.removeEventListener("offline", wentOffline);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting && online) return null;
  return (
    <>
      {!online && <div className="offline-banner" role="status">You are offline. Saved practice remains on this device; reconnect before signing in or syncing Docker content.</div>}
      {waiting && <div className="pwa-update" role="status"><span>An app update is ready.</span><button type="button" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>Refresh</button></div>}
    </>
  );
}
