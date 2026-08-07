"use client";

import { useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  HIDE-ON-SCROLL-DOWN, REVEAL-ON-SCROLL-UP — the native app pattern.
//
//  ── Read this before reusing it ────────────────────────────────────────────
//  This hook returns a BOOLEAN. It does not, and must not, be used to change
//  the HEIGHT of anything.
//
//  The events filter bar already shipped a scroll-driven collapse once and it
//  had to be torn out (see the header of components/events/event-filters). It
//  collapsed rows, i.e. it changed the height of a `position: sticky` element,
//  and sticky elements are IN FLOW — so every collapse reflowed the entire list
//  underneath while the reader was scrolling through it. Worse, it could
//  oscillate: collapsing removes height, the content below shifts up, the
//  scroll position clamps, and the clamp can flip the state straight back. A
//  control loop with no damping.
//
//  The ONLY safe way to move a sticky bar out of the way is `transform:
//  translateY(...)`, which is composited and contributes nothing to layout.
//  Consumers of this hook must translate, never resize.
//
//  ── Why it listens to an element and not to `window` ───────────────────────
//  The document never scrolls in this app. AppShell is a 100dvh flex frame and
//  `#main` is the single real scroll region, so a `window` scroll listener here
//  would fire exactly never.
// ════════════════════════════════════════════════════════════════════════════

export interface HideOnScrollOptions {
  /** Id of the scroll container. Defaults to the app shell's `#main`. */
  scrollerId?: string;
  /**
   * Movement required before the state flips, in px. Without a deadband a bar
   * flickers on the sub-pixel jitter of a trackpad or an iOS rubber-band.
   */
  threshold?: number;
  /**
   * Never hide within this many px of the top. Hiding immediately feels broken:
   * the reader has barely moved and the controls have already gone.
   */
  revealAbove?: number;
  /** Force-reveal — e.g. while a panel that belongs to the bar is open. */
  disabled?: boolean;
}

export function useHideOnScroll({
  scrollerId = "main",
  threshold = 8,
  revealAbove = 120,
  disabled = false,
}: HideOnScrollOptions = {}): boolean {
  const [hidden, setHidden] = useState(false);
  // Kept in a ref, not state: these change on every scroll frame and none of
  // them may cause a render.
  const lastY = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) {
      setHidden(false);
      return;
    }

    const scroller = document.getElementById(scrollerId);
    if (!scroller) return;

    lastY.current = scroller.scrollTop;

    const measure = () => {
      frame.current = null;
      const y = scroller.scrollTop;

      // Near the top, or the page is too short to scroll meaningfully: always
      // show. The second case matters — a filtered list of two events must not
      // be able to hide its own filters and leave no way to scroll them back.
      if (y <= revealAbove || scroller.scrollHeight - scroller.clientHeight < revealAbove) {
        lastY.current = y;
        setHidden(false);
        return;
      }

      const dy = y - lastY.current;
      // Below the deadband: not a deliberate direction change. Leave `lastY`
      // alone so slow, steady scrolling still accumulates to a flip rather than
      // being discarded frame by frame.
      if (Math.abs(dy) < threshold) return;

      lastY.current = y;
      setHidden(dy > 0);
    };

    const onScroll = () => {
      // One state update per painted frame at most. A raw scroll handler can
      // fire far more often than that on a high-rate trackpad.
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [scrollerId, threshold, revealAbove, disabled]);

  return disabled ? false : hidden;
}
