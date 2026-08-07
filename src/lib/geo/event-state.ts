// ════════════════════════════════════════════════════════════════════════════
//  Event map state — the ONE definition of "what is this pin doing right now".
//
//  ── Why this is its own module ────────────────────────────────────────────
//  Three surfaces need the same answer: the MARKER (colour, ring, animation),
//  the PREVIEW CARD (badge, countdown treatment) and the sort order. Before
//  this, "is it live?" was `pin.status === "LIVE"` written out at each of those
//  call sites, and "fight week" did not exist anywhere. Adding a state that way
//  means finding every comparison and hoping none was missed — and the failure
//  is silent: a marker in the wrong state still renders.
//
//  So the derivation lives here, PURE, and every surface reads it.
//
//  ── Why FIGHT_WEEK is derived from the clock, not from a column ───────────
//  There is no `fightWeek` column and there should not be: it is not a fact
//  about the event, it is a fact about how far away it is. The database would
//  need a cron to flip it and would be wrong between runs. A pure function of
//  (status, date, now) is right at every instant by construction.
//
//  PURE. No prisma, no React, no `Date.now()` — the caller passes `now`, which
//  is what makes it testable and what lets the client share ONE clock reading
//  across every pin on screen (see lib/use-countdown).
// ════════════════════════════════════════════════════════════════════════════

/** What an event pin is doing, in the order urgency rises. */
export type EventMapState =
  /** Further out than fight week. The default. */
  | "UPCOMING"
  /** Inside seven days. The card is imminent and the map should say so. */
  | "FIGHT_WEEK"
  /** Happening now. */
  | "LIVE"
  /** Already fought. Kept on the map briefly so results are discoverable. */
  | "COMPLETED"
  /** Called off, or moved with no new date. Shown, not hidden — see below. */
  | "CANCELLED";

/** Seven days. The window in which the trade calls it fight week. */
export const FIGHT_WEEK_MS = 7 * 86_400_000;

/**
 * How long after the first bell an event still reads as LIVE when the status
 * column has not caught up.
 *
 * Statuses are written by scrapers on a cron, so an event that started twenty
 * minutes ago is very often still `SCHEDULED` in the database. Trusting the
 * column alone means the map shows nothing live during the exact hours anyone
 * would open it to find something live. Six hours covers prelims-through-main
 * for every combat card and expires on its own.
 */
export const LIVE_GRACE_MS = 6 * 3_600_000;

export interface EventStateInput {
  /** `Event.status`. May lag reality — see LIVE_GRACE_MS. */
  status: string | null | undefined;
  /** ISO timestamp of the first bell. */
  date: string | null | undefined;
  /** The caller's clock reading. Null before hydration — see the return note. */
  now: number | null;
}

/**
 * Derive the state.
 *
 * Precedence, and why:
 *   1. CANCELLED and COMPLETED are FACTS that outrank the clock. A cancelled
 *      card whose date is tonight is not live and must never pulse like it.
 *   2. An explicit LIVE status is believed immediately.
 *   3. Otherwise the clock decides, because the column lags (LIVE_GRACE_MS).
 *
 * Returns UPCOMING when `now` is null — the server and the hydration pass,
 * where the clock is genuinely unknown. That is the calm state on purpose: a
 * pin that flashed LIVE for one frame before hydration corrected it would be
 * the map's version of the "Live / Final" bug the countdown module documents.
 */
export function eventMapState(input: EventStateInput): EventMapState {
  const status = (input.status ?? "").toUpperCase();

  if (status === "CANCELLED" || status === "POSTPONED") return "CANCELLED";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "LIVE") return "LIVE";

  const target = input.date ? new Date(input.date).getTime() : NaN;
  if (!Number.isFinite(target) || input.now === null) return "UPCOMING";

  const delta = target - input.now;
  if (delta <= 0) return -delta <= LIVE_GRACE_MS ? "LIVE" : "COMPLETED";
  if (delta <= FIGHT_WEEK_MS) return "FIGHT_WEEK";
  return "UPCOMING";
}

/**
 * Presentation for each state, in ONE table.
 *
 * `accent` is a raw colour rather than a Tailwind class because the marker is
 * built as an innerHTML string inside Leaflet (see map-canvas), where a utility
 * class from the app's stylesheet is not in scope. The preview card, which IS
 * React, reads the same value so the pin and the card it opens can never
 * disagree about what colour "live" is.
 */
export interface EventStateStyle {
  /** Short uppercase badge text, or null when the state needs no badge. */
  badge: string | null;
  /** Marker + card accent. */
  accent: string;
  /** Marker modifier class, consumed by globals.css. */
  pinClass: string;
  /** Does this state deserve a pulsing halo? Live only — see below. */
  pulse: boolean;
  /** Sort weight: lower sorts first. */
  weight: number;
}

// Only LIVE pulses. "Subtle animation is encouraged" cuts both ways: if fight
// week also pulsed, then on a normal week most of the map would be pulsing and
// the one thing that is actually happening RIGHT NOW would stop standing out.
// Scarcity is what makes the live pin loud.
export const EVENT_STATE_STYLE: Record<EventMapState, EventStateStyle> = {
  LIVE: { badge: "Live", accent: "#e11d2a", pinClass: "is-live", pulse: true, weight: 0 },
  FIGHT_WEEK: { badge: "Fight week", accent: "#f97316", pinClass: "is-fightweek", pulse: false, weight: 1 },
  UPCOMING: { badge: null, accent: "#e11d2a", pinClass: "is-upcoming", pulse: false, weight: 2 },
  COMPLETED: { badge: "Result", accent: "#64748b", pinClass: "is-completed", pulse: false, weight: 3 },
  CANCELLED: { badge: "Cancelled", accent: "#64748b", pinClass: "is-cancelled", pulse: false, weight: 4 },
};

/** True when the pin should read as "something is happening here now". */
export const isLiveState = (s: EventMapState): boolean => s === "LIVE";

/**
 * States that no longer take predictions or sell tickets.
 *
 * Grouped rather than compared inline so a card cannot end up offering
 * "Tickets" on a cancelled event because one component forgot a case.
 */
export const isPastState = (s: EventMapState): boolean =>
  s === "COMPLETED" || s === "CANCELLED";
