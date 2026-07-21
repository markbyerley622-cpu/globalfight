"use client";

import { useEffect } from "react";

// Registers the service worker (production only, to avoid interfering with dev
// HMR) and handles the update flow: when a new SW is installed while an old one
// controls the page, tell it to skipWaiting and reload once — so a fresh deploy
// takes effect without leaving anyone on a stale shell.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              next.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {
        /* registration failures are non-fatal — the app works without the SW */
      });
  }, []);

  return null;
}
