"use client";

import { useEffect } from "react";
import { useCoarseNow } from "@/lib/use-countdown";
import { HEARTBEAT_MS, presenceOf, lastSeenLabel, type PresenceState } from "./derive";

// ════════════════════════════════════════════════════════════════════════════
//  Presence — the client side.
//
//  Two hooks, deliberately separate: one PUBLISHES that you are here, one READS
//  whether somebody else is. Coupling them would mean every avatar that wants a
//  green dot also starts a heartbeat.
// ════════════════════════════════════════════════════════════════════════════

/** Module-level, so N mounted components share ONE heartbeat, not N. */
let beaters = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function beat() {
  // `keepalive` so a beat still leaves the browser if the user navigates
  // mid-interval. Failures are ignored: presence is ambient, and a dropped beat
  // simply means the timestamp is one interval older.
  void fetch("/api/presence/heartbeat", { method: "POST", keepalive: true }).catch(() => {});
}

function start() {
  if (timer !== null) return;
  beat();
  timer = setInterval(beat, HEARTBEAT_MS);
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function onVisibility() {
  if (beaters === 0) return;
  // A hidden tab is NOT presence. Beating from a backgrounded tab is what makes
  // "online" meaningless — it would report somebody as present for as long as a
  // browser window stayed open behind everything else. Stopping is also what
  // makes the decay in `derive` do its job: they fall to "away" on their own.
  if (document.visibilityState === "visible") start();
  else stop();
}

/**
 * Publish "I'm here" while this component is mounted and the tab is visible.
 *
 * Mount it on the messaging surfaces (inbox, thread) rather than app-wide: it
 * is a write on a timer, and presence is only meaningful where somebody is
 * being waited on. Signed-out visitors are harmless — the endpoint no-ops
 * without an identity.
 */
export function useHeartbeat(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    beaters += 1;
    if (beaters === 1) {
      document.addEventListener("visibilitychange", onVisibility);
      if (document.visibilityState === "visible") start();
    }
    return () => {
      beaters -= 1;
      if (beaters === 0) {
        document.removeEventListener("visibilitychange", onVisibility);
        stop();
      }
    };
  }, [enabled]);
}

/**
 * Read somebody's presence from their raw heartbeat timestamp.
 *
 * Decays on the MINUTE clock, so a card whose subject went quiet visibly drops
 * to "away" without waiting for the next poll — and without re-rendering the
 * surface once a second to do it. The one shared interval means an inbox of
 * fifty rows costs one timer, not fifty.
 */
export function usePresence(lastSeenAt: string | null | undefined): {
  state: PresenceState;
  label: string | null;
} {
  const now = useCoarseNow(60_000);
  return {
    state: presenceOf({ lastSeenAt, now }),
    label: lastSeenLabel({ lastSeenAt, now }),
  };
}
