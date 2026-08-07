"use client";

import { useEffect, useState } from "react";
import { Countdown } from "@/components/countdown";

/**
 * The hero card's countdown, gated on mount.
 *
 * `Countdown` computes its first tick inside an effect, so before hydration it
 * has nothing to show and renders its zero-state — the words **"Live / Final"**.
 * On an event card buried in a list that is a flicker; on the single largest
 * element of the landing page it is a wrong sentence about the featured fight,
 * sitting in the server HTML where a crawler reads it and never re-renders.
 *
 * Rendering nothing until mounted is the fix that does not risk a hydration
 * mismatch. The obvious alternative — seeding the countdown's state during
 * render — makes the server and the client compute a duration from two
 * different clocks, and React reports the one-minute disagreement as a
 * hydration error. Server and first client render both produce nothing here, so
 * they agree exactly; the clock appears one frame later.
 *
 * The slot keeps its height either way, so the card does not shift when the
 * clock arrives.
 */
export function HeroCountdown({ date }: { date: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="hl-countdown">
      {mounted && (
        <>
          <span className="hl-countdown-label">Starts in</span>
          <Countdown date={date} compact />
        </>
      )}
    </div>
  );
}
