"use client";

import { useEffect, useState } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  Which way is the reader scrolling?
//
//  For the hide-on-scroll-down / reveal-on-scroll-up pattern. Three details do
//  all the work, and getting any of them wrong is what makes this feel cheap:
//
//  ── 1. It listens to `#main`, not to the window ──────────────────────────
//  AppShell is a 100dvh frame with `overflow-hidden` and the page lives in
//  `<main id="main" class="overflow-y-auto">`. The DOCUMENT never scrolls — its
//  scrollTop is permanently 0 — so a window scroll listener fires never. Same
//  root cause as the scroll-restoration bug (see components/layout/
//  scroll-restoration), and the same fix.
//
//  ── 2. A movement THRESHOLD ──────────────────────────────────────────────
//  Without one, a one-pixel wobble at the end of a fling flips the direction and
//  the bar flickers. Anything under the threshold is not a direction change, it
//  is noise.
//
//  ── 3. Coalesced to one frame ────────────────────────────────────────────
//  Scroll fires far faster than the screen repaints. Doing the work per event
//  puts React state updates on the scroll path, which is precisely how a list
//  starts to feel like it is dragging.
// ════════════════════════════════════════════════════════════════════════════

export type ScrollDirection = "up" | "down";

export interface ScrollDirectionOptions {
  /** Pixels of movement before a direction change is believed. */
  threshold?: number;
  /**
   * Always report "up" within this many pixels of the top.
   *
   * At the top of a list there is nothing to get out of the way of, and a
   * control that stays hidden up there looks broken rather than clever.
   */
  topZone?: number;
}

export function useScrollDirection(opts: ScrollDirectionOptions = {}): ScrollDirection {
  const { threshold = 6, topZone = 24 } = opts;
  const [direction, setDirection] = useState<ScrollDirection>("up");

  useEffect(() => {
    const el = document.getElementById("main");
    if (!el) return;

    let last = el.scrollTop;
    let queued = false;

    const measure = () => {
      queued = false;
      const y = el.scrollTop;

      if (y <= topZone) {
        last = y;
        setDirection("up");
        return;
      }
      const delta = y - last;
      if (Math.abs(delta) < threshold) return;
      last = y;
      setDirection(delta > 0 ? "down" : "up");
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };

    // Passive: this never calls preventDefault, and saying so lets the browser
    // scroll without waiting to find out.
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold, topZone]);

  return direction;
}
