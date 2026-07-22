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

    // Was this page already under a service worker when it loaded?
    //
    // This is the whole difference between an UPDATE and a FIRST INSTALL, and
    // getting it wrong is expensive: sw.js calls clients.claim() on activate,
    // which fires controllerchange on the very first visit too. Reloading on
    // that fired a full page reload at every new visitor, mid-load — measured
    // at 3 main-frame navigations and 17 killed requests on 5/5 cold visits,
    // which is a wasted round trip for everyone and a half-hydrated page for
    // the unlucky. A first install has nothing to refresh: the page is already
    // running the only version there is.
    const hadController = !!navigator.serviceWorker.controller;

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
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
