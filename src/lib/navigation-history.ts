"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

// ════════════════════════════════════════════════════════════════════════
//  "Is there somewhere in this app to go back to?"
//
//  Every Back control needs this answer, and getting it wrong is worse in both
//  directions: guess yes and `router.back()` walks the user out of the site to
//  whatever they were browsing before; guess no and we `push()` a fresh navigation
//  that discards their scroll position and their place in the app.
//
//  `document.referrer` cannot answer it. It describes the document, and an App
//  Router SPA loads the document once — client-side navigation never updates it, and
//  it is empty entirely for a typed URL, a bookmark or the installed PWA.
//
//  So count the navigations that happen inside this document. The counter lives at
//  module scope rather than in sessionStorage on purpose: a full page load is exactly
//  the moment the answer should reset to "no". After a reload the browser's history
//  stack still contains the earlier entries, but we can no longer know whether the
//  entry behind us belongs to this app or to the site the user came from, and the
//  safe answer to that is the conservative one — offer the explicit fallback rather
//  than risk ejecting them.
// ════════════════════════════════════════════════════════════════════════

/** In-app route changes since this document loaded. */
let inAppNavigations = 0;

/** Subscribers, so a Back button that is already mounted re-renders when this flips. */
const listeners = new Set<() => void>();

function bump() {
  inAppNavigations += 1;
  // Only the 0 → 1 transition changes any answer; later increments are noise.
  if (inAppNavigations === 1) listeners.forEach((fn) => fn());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

const getSnapshot = () => inAppNavigations > 0;
/** On the server there is no history, so no Back control may claim otherwise. */
const getServerSnapshot = () => false;

/**
 * Mounted once by AppShell. Counts route changes; the first render is the landing
 * page, which is not a navigation.
 */
export function useTrackNavigation() {
  const pathname = usePathname();
  useEffect(() => {
    // Skip the initial mount: arriving at the entry page is not something to go back
    // from. Every subsequent pathname change is.
    if (firstPath === null) { firstPath = pathname; return; }
    if (pathname !== lastPath) bump();
    lastPath = pathname;
  }, [pathname]);
}

let firstPath: string | null = null;
let lastPath: string | null = null;

/**
 * True when `router.back()` is guaranteed to stay inside the app.
 *
 * `useSyncExternalStore` rather than state-synced-in-an-effect: the counter above IS
 * an external store, so this reads it during render (no cascading re-render, no
 * mismatch on a Back button that mounts after the navigation that flipped it) and
 * returns the correct value for SSR.
 */
export function useCanGoBack(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
