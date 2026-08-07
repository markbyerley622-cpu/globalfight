"use client";

import { useEffect } from "react";
import { useCoarseNow } from "@/lib/use-countdown";
import { HEARTBEAT_MS, presenceOf, lastSeenLabel, type PresenceState } from "./derive";
import type { PresenceDto } from "./policy";

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
 * Read somebody's presence from the DTO the server already filtered.
 *
 * ── The privacy decision is NOT made here ─────────────────────────────────
 * This takes a `PresenceDto`, which the server built with `presenceDtoFor` —
 * a hidden user's timestamp is already absent from it. So there is no way for a
 * component to accidentally render presence somebody switched off: it has
 * nothing to render it FROM. All this hook does is decay a timestamp it was
 * given permission to see.
 *
 * Decays on the MINUTE clock, so somebody who goes quiet visibly drops to
 * "away" without waiting for the next poll — and without re-rendering the
 * surface once a second to do it. One shared interval means an inbox of fifty
 * rows costs one timer, not fifty.
 */
export function usePresence(presence: PresenceDto | null | undefined): {
  state: PresenceState | "hidden";
  label: string | null;
  hidden: boolean;
} {
  const now = useCoarseNow(60_000);

  if (!presence || presence.hidden) {
    return { state: "hidden", label: null, hidden: true };
  }

  const state = presenceOf({ lastSeenAt: presence.lastSeenAt, now });
  // With history withheld, the live states may still be NAMED — hiding "last
  // seen" was never a request to hide "is online right now", which the dot is
  // showing anyway. Anything older resolves to no words at all.
  const label = presence.showLastSeen
    ? lastSeenLabel({ lastSeenAt: presence.lastSeenAt, now })
    : state === "online" ? "Active now" : null;

  return { state, label, hidden: false };
}
