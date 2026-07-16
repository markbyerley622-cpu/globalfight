"use client";

import { useEffect } from "react";

/**
 * Seamless deploys. When a new build ships, browsers that still hold the old
 * page reference chunk hashes the deploy replaced — navigating then throws
 * `ChunkLoadError` / "Loading chunk N failed" and the view breaks. This catches
 * those and reloads once (guarded against loops) so the user silently lands on
 * the fresh build instead of a broken screen.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const isChunkError = (s?: string) =>
      !!s &&
      (/ChunkLoadError/i.test(s) ||
        /Loading chunk [\w-]+ failed/i.test(s) ||
        /Loading CSS chunk/i.test(s) ||
        /error loading dynamically imported module/i.test(s) ||
        /Importing a module script failed/i.test(s));

    const reloadOnce = () => {
      const KEY = "cr:chunk-reload";
      try {
        const last = Number(sessionStorage.getItem(KEY) || 0);
        if (Date.now() - last < 10_000) return; // never loop faster than 10s
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* storage blocked — still attempt a single reload */
      }
      window.location.reload();
    };

    const onError = (e: ErrorEvent) => {
      const err = e.error as { name?: string; message?: string } | undefined;
      if (isChunkError(e.message) || isChunkError(err?.name) || isChunkError(err?.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined;
      if (isChunkError(r?.name) || isChunkError(r?.message)) reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
