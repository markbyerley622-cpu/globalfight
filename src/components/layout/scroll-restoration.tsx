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
/**
 * Consecutive frames the container height must hold steady before we accept that
 * the page has finished growing. Three frames (~50ms at 60fps) is long enough to
 * ride out a single slow image or a streamed RSC chunk, short enough that a page
 * which really is done stops immediately.
 */
const SETTLED_FRAMES = 3;
/**
 * Absolute ceiling on the convergence loop.
 *
 * NOT a settle estimate — the height check decides that. This exists only so a
 * page that never stops growing (a stuck infinite-scroll sentinel) cannot hold a
 * requestAnimationFrame loop open forever.
 */
const MAX_RESTORE_MS = 5000;

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

    // Back/Forward arrives one of TWO ways, and only one of them fires popstate.
    //
    //   SPA navigation      -> popstate fires, isPop is set. Handled.
    //   FULL DOCUMENT LOAD  -> no popstate. The listener above was registered
    //                          milliseconds ago on a brand-new document, so the
    //                          event it was waiting for already happened — in the
    //                          previous document.
    //
    // The second case is the one users were hitting: Back off a hard navigation
    // (or a bfcache miss) reloads the document, `pop` was false, and line below
    // deliberately targeted 0. So the restoration was correct and simply never
    // ran — "Back reloads and dumps me at the top" is exactly that shape.
    //
    // The Navigation Timing API is the browser's own record of WHY this document
    // exists. `back_forward` means the user pressed Back, whether or not React
    // ever saw a popstate.
    const navType = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type;
    const restoredDocument = navType === "back_forward";

    const pop = isPop.current || restoredDocument;
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
        // Give up when the CONTENT STOPS GROWING, not when a stopwatch expires.
        //
        // This was `performance.now() < deadline` against a fixed 600ms. That is a
        // guess about how long a route takes to settle, and it silently became wrong
        // as the app grew: an events list of 418 cards with images is still
        // lengthening well past 600ms, so the loop quit while the container was
        // shorter than the saved offset and the scroll clamped short. The symptom is
        // "Back lands near, but not at, where I was" — and the fix keeps being to
        // raise the number, on the fastest machine in the room.
        //
        // Growth is the real signal. While scrollHeight is still increasing there is
        // more to come, so keep re-applying however long that takes; once it has held
        // steady for a few frames the page has settled and the position we can reach
        // is the position that exists. The wall clock survives only as a hard stop
        // against a genuinely endless page (a stuck infinite-scroll sentinel).
        const hardStop = performance.now() + MAX_RESTORE_MS;
        let tallest = -1;
        let settledFrames = 0;

        const apply = () => {
          if (cancelled) return;
          if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
          // Reached it — nothing further to do, however much more loads after.
          if (el.scrollTop >= target - 1) return;

          const height = el.scrollHeight;
          if (height > tallest) {
            tallest = height;
            settledFrames = 0;
          } else {
            settledFrames += 1;
          }

          if (settledFrames < SETTLED_FRAMES && performance.now() < hardStop) {
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
