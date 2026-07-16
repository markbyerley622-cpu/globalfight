"use client";

import { useEffect } from "react";

/**
 * Locks the page behind a modal/overlay.
 *
 * Every call site used to do `document.body.style.overflow = "hidden"`, which
 * locks nothing here: the app shell is `h-[100dvh] overflow-hidden` and the real
 * scroll container is `<main id="main">` (app-shell.tsx), so the body has no
 * scroll to take away. The lightboxes are bare `fixed inset-0` layers with no
 * scroller of their own, so a touch-drag chained straight through to <main> and
 * scrolled the page behind the modal.
 *
 * Ref-counted because overlays nest (a reel can open a discussion sheet): the
 * inner one unmounting must not unlock while the outer is still open. The
 * original inline style is captured on the first lock and restored by the last
 * release, so we never clobber a value the shell set itself.
 */
let locks = 0;
let restore: string | null = null;

function acquire() {
  const main = document.getElementById("main");
  if (!main) return;
  if (locks === 0) {
    restore = main.style.overflow;
    main.style.overflow = "hidden";
  }
  locks += 1;
}

function release() {
  const main = document.getElementById("main");
  if (!main) return;
  locks = Math.max(0, locks - 1);
  if (locks === 0) {
    main.style.overflow = restore ?? "";
    restore = null;
  }
}

/** Locks <main> while `active` is true. Pass false to opt out conditionally. */
export function useScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}
