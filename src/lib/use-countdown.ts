"use client";

import { useSyncExternalStore } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  ONE clock for the whole app.
//
//  ── Why a singleton and not a useEffect per component ──────────────────────
//  A 12-card events grid renders 12 countdowns; the schedule page renders more.
//  The old pattern was `useState` + `setInterval(…, 1000)` INSIDE each one, so
//  a full grid ran a dozen independent timers, each waking on its own phase.
//  They also drifted apart visually — twelve clocks ticking a few milliseconds
//  out of step, which is exactly the kind of thing that reads as "janky" without
//  the reader being able to say why.
//
//  One interval, one `Date.now()`, one notify. Every countdown on the page
//  advances on the SAME frame, and adding a countdown costs a Set entry rather
//  than a timer.
//
//  ── Why it stops when the tab is hidden ────────────────────────────────────
//  A backgrounded tab has nobody to show a second to. Browsers already clamp
//  background intervals, but clamped is not stopped: a phone left on this page
//  keeps waking the main thread to re-render numbers nobody can see. We stop
//  outright and take one fresh reading on return, so the first visible frame is
//  already correct rather than catching up.
// ════════════════════════════════════════════════════════════════════════════

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * The cached reading. `getSnapshot` MUST return a stable value between renders —
 * returning a fresh `Date.now()` on every call makes React see a changed store
 * on every check and re-render forever. So the value only moves on a tick.
 */
let current = 0;

function publish() {
  current = Date.now();
  for (const fn of subscribers) fn();
}

function start() {
  if (timer !== null) return;
  publish();
  timer = setInterval(publish, 1000);
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function onVisibility() {
  if (subscribers.size === 0) return;
  if (document.visibilityState === "visible") start();
  else stop();
}

function subscribe(fn: () => void): () => void {
  const first = subscribers.size === 0;
  subscribers.add(fn);
  if (first) {
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") start();
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    }
  };
}

/**
 * The current time, or `null` on the server and during hydration.
 *
 * The null is load-bearing. `getServerSnapshot` is what React renders on the
 * server AND on the client's hydration pass, so both agree by construction and
 * no countdown can trip a hydration mismatch. The real value arrives on the
 * commit straight after.
 */
function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => current || Date.now(),
    () => null,
  );
}

/**
 * The current time, QUANTIZED — a reading that only changes every `stepMs`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Some consumers need the clock but must not re-render at 1Hz. The map is the
 * case that forced it: every marker's lifecycle state (upcoming / fight week /
 * live) is a function of now, and the markers are rebuilt from scratch whenever
 * that input changes. On the per-second clock the map would tear down and
 * recreate every Leaflet marker once a second — pins re-running their entrance
 * animation forever, and a click landing on a marker that no longer exists.
 *
 * The quantization is done INSIDE `getSnapshot`, which is what makes it work:
 * React compares snapshots with `Object.is` and skips the re-render entirely
 * when the value is unchanged. So this shares the one existing interval and
 * simply declines to wake its consumers 59 times a minute.
 *
 * Returns null on the server and during hydration, exactly like `useCountdown`.
 */
export function useCoarseNow(stepMs = 60_000): number | null {
  const step = Math.max(1, stepMs);
  return useSyncExternalStore(
    subscribe,
    () => Math.floor((current || Date.now()) / step) * step,
    () => null,
  );
}

/**
 * How close a countdown is, as a named band rather than a raw millisecond
 * comparison repeated at every call site.
 *
 * The thresholds are the product's, in one place: inside a day an event is
 * "tonight" and inside an hour it is "right now", and every surface that wants
 * to look more urgent reads the same word for it.
 */
export type Urgency = "scheduled" | "soon" | "urgent" | "critical";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Whole milliseconds left. */
  ms: number;
  urgency: Urgency;
}

export function urgencyOf(ms: number): Urgency {
  if (ms < HOUR_MS) return "critical";
  if (ms < DAY_MS) return "urgent";
  if (ms < WEEK_MS) return "soon";
  return "scheduled";
}

export interface CountdownState {
  /** Time left, or null when the target has passed OR is not measured yet. */
  remaining: Remaining | null;
  /**
   * The reading this state was derived from, or null when unmeasured.
   *
   * Exposed so callers that need the wall clock (e.g. "is the target on the
   * reader's own calendar day?") can use the SAME instant the countdown used,
   * rather than calling `Date.now()` during render — which is impure, can
   * disagree with the digits beside it, and is flagged by the React compiler.
   */
  now: number | null;
  /**
   * Has the target passed?
   *
   * `null` means NOT MEASURED YET — the server and the hydration pass, where we
   * genuinely do not know. Callers must branch on this rather than on
   * `remaining === null`, which conflates "finished" with "not measured".
   *
   * That conflation was a real, visible bug: `Countdown` rendered the words
   * "Live / Final" whenever `remaining` was null, so EVERY upcoming event
   * flashed "Live / Final" for a frame before hydration replaced it with a
   * three-week countdown.
   */
  started: boolean | null;
}

/** Live time-remaining for an ISO timestamp. */
export function useCountdown(iso: string): CountdownState {
  const now = useNow();
  const target = new Date(iso).getTime();

  // An unparseable date is not a countdown. Rendering NaN cells is worse than
  // rendering nothing, and this is reachable — ingested events carry dates from
  // scrapers.
  if (!Number.isFinite(target)) return { remaining: null, started: null, now: null };
  if (now === null) return { remaining: null, started: null, now: null };

  const ms = target - now;
  if (ms <= 0) return { remaining: null, started: true, now };

  return {
    started: false,
    now,
    remaining: {
      days: Math.floor(ms / DAY_MS),
      hours: Math.floor((ms % DAY_MS) / HOUR_MS),
      minutes: Math.floor((ms % HOUR_MS) / 60_000),
      seconds: Math.floor((ms % 60_000) / 1000),
      ms,
      urgency: urgencyOf(ms),
    },
  };
}

/**
 * The countdown as a sentence, for screen readers and `title`.
 *
 * Deliberately COARSE: it stops at minutes. A per-second live region would have
 * a screen reader announcing a new number every second, which makes the rest of
 * the page unusable — the digits are `aria-hidden` and this is what is exposed.
 */
export function spokenRemaining(r: Remaining): string {
  const parts: string[] = [];
  if (r.days) parts.push(`${r.days} day${r.days === 1 ? "" : "s"}`);
  if (r.hours) parts.push(`${r.hours} hour${r.hours === 1 ? "" : "s"}`);
  // Minutes are only interesting once the days are gone; "12 days 4 hours 7
  // minutes" is not how anyone says it.
  if (!r.days && r.minutes) parts.push(`${r.minutes} minute${r.minutes === 1 ? "" : "s"}`);
  if (parts.length === 0) return "under a minute";
  return parts.join(" ");
}
