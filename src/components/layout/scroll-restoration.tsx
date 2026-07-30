"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// ════════════════════════════════════════════════════════════════════════
//  Scroll restoration for the app's REAL scroll container.
//
//  This is the root cause of "I get sent back to the top of the page", and it
//  affected every route at once.
//
//  AppShell is a 100dvh frame with `overflow-hidden`, and page content lives in
//  `<main id="main" class="overflow-y-auto">`. So the DOCUMENT never scrolls — its
//  scrollTop is permanently 0, and all real scrolling happens on that inner element.
//
//  Both mechanisms that would normally restore position operate on the document
//  scroller and only on the document scroller:
//
//    • the browser's own `history.scrollRestoration`, and
//    • Next's App Router restoration, which calls window.scrollTo on popstate.
//
//  Both therefore "restored" a scroll position of 0 on an element already at 0, and
//  nothing ever touched `#main`. Back always landed at the top, on every route. No
//  amount of fixing individual Back buttons could have helped — the position was
//  never recorded anywhere to begin with.
//
//  So we record it ourselves and restore it on Back/Forward.
//
//  Keying: by `pathname + search`, not by a history-entry id. Next owns
//  `history.state` and replaces it on its own navigations, so a key stored there does
//  not survive. A URL key also means filter / tab / pagination state — all of which
//  live in the query string on these routes — restores to the position belonging to
//  those filters. The known trade-off is that one URL occupying two history depths
//  shares a single recorded position: rare, and far less wrong than always landing at
//  the top.
// ════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = "gf:scrollPositions";
/** Cap the map so a long session cannot grow it without bound. */
const MAX_ENTRIES = 60;
/** How long to keep re-applying the target while async content settles, ms. */
const RESTORE_WINDOW_MS = 600;

type Positions = Map<string, number>;

function load(): Positions {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, number>));
  } catch {
    return new Map();
  }
}

/**
 * Flushed on pagehide only, never on scroll. Writing to sessionStorage on every
 * scroll event would put JSON serialisation on the scroll path — exactly the kind of
 * main-thread work that makes a long list feel like it is dragging.
 */
function save(positions: Positions) {
  try {
    const trimmed = [...positions.entries()].slice(-MAX_ENTRIES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Private mode / quota exceeded. Restoration degrades to in-memory, which is fine.
  }
}

/**
 * Mounted once, inside AppShell (it needs `#main` to exist). Wrapped in Suspense by
 * the caller because of `useSearchParams`.
 */
export function ScrollRestoration() {
  const pathname = usePathname();
  // The full query string, so a filter/tab/page change is treated as its own
  // position — not as "still the same page" under the previous scroll offset.
  const search = useSearchParams().toString();
  const key = search ? `${pathname}?${search}` : pathname;

  const positions = useRef<Positions | null>(null);
  /** Set by popstate: the navigation now in flight is a Back/Forward, not a push. */
  const isPop = useRef(false);

  useEffect(() => {
    positions.current ??= load();

    // `popstate` fires before React renders the new route, so this flag is always set
    // in time for the navigation effect below to read it.
    const onPop = () => { isPop.current = true; };
    const onHide = () => { if (positions.current) save(positions.current); };

    window.addEventListener("popstate", onPop);
    // `pagehide` rather than `beforeunload`: beforeunload is unreliable on mobile
    // Safari and disqualifies the page from the back/forward cache.
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  useEffect(() => {
    const el = document.getElementById("main");
    const store = (positions.current ??= load());
    if (!el) return;

    const pop = isPop.current;
    isPop.current = false;

    // A hash is an explicit request for a specific element. Leave it to the browser
    // and to the event page's scroll-spy; do not fight either.
    const hasHash = window.location.hash.length > 1;

    let cancelled = false;
    if (!hasHash) {
      // Restore only when going Back/Forward. A fresh push is a new destination and
      // belongs at the top — anything else would be its own "why am I halfway down
      // this page" bug.
      const target = pop ? store.get(key) ?? 0 : 0;

      if (target === 0) {
        el.scrollTop = 0;
      } else {
        // The container is usually not tall enough yet: the route's RSC payload,
        // images and any client-fetched lists are still resolving, so a single
        // assignment clamps to the height that exists right now and lands short.
        // Re-apply across frames until the position sticks or the window closes —
        // a convergence loop, not a polling timer.
        const deadline = performance.now() + RESTORE_WINDOW_MS;
        const apply = () => {
          if (cancelled) return;
          if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
          if (el.scrollTop < target - 1 && performance.now() < deadline) {
            requestAnimationFrame(apply);
          }
        };
        apply();
      }
    }

    // Record this entry's position as the user scrolls, coalesced to one write per
    // frame so a fling does not run this on every scroll event.
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        store.set(key, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelled = true;
      // Capture the final position on the way out, so a push navigation still leaves
      // an accurate entry behind for the eventual return.
      store.set(key, el.scrollTop);
      el.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  return null;
}
