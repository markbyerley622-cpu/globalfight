// ════════════════════════════════════════════════════════════════════════
//  Is this event worth showing anyone?
//
//  ONE rule, used by every surface that lists events, so "we don't show empty
//  cards" cannot be true on /events and false on /today.
//
//  ── Why this is NOT "has at least one bout" ────────────────────────────
//
//  That was the obvious rule and it is wrong here. Measured against the live
//  database: 108 events have zero bouts and ALL 108 are ONE Championship. ONE
//  publishes no per-card article, so the year-page provider is the only source
//  and it yields date + venue + name with no bout list (see the year-page
//  provider notes). Eleven of those are UPCOMING.
//
//  "ONE Fight Night 50 · Lumpinee Stadium, Bangkok · 12 December" is not an
//  empty card. It is a real, correctly-ingested, announced event whose bouts
//  are not published yet — exactly the thing a fan wants to follow. A bout-count
//  rule would delete it, along with ten others, and would read as "GlobalFight
//  doesn't cover ONE" rather than "the card isn't out yet".
//
//  So the test is whether there is anything a reader can DO with the card:
//
//    upcoming + real identity          → render. Bouts TBA is a state, not a gap.
//    past + no bouts                   → hide. Nothing happened that we can show.
//    no real identity (name/promotion) → hide, whatever the date.
//
//  The third case is the one the brief actually described — a "Boxing —
//  2 August" shell with no promotion and nothing on it. That shape does not
//  exist in the local database (0 rows match), so it is production-only; the
//  rule covers it regardless, and `eventSkipReason` names it when it appears.
// ════════════════════════════════════════════════════════════════════════

import type { FightEvent } from "@/lib/types";

export type SkipReason =
  | "NO_NAME"
  | "SPORT_DATE_SHELL"
  | "NO_PROMOTION_NO_BOUTS"
  | "PAST_WITH_NO_BOUTS"
  | "NO_DATE";

/** Human-readable, for the audit report and the skip log. */
export const SKIP_LABEL: Record<SkipReason, string> = {
  NO_NAME: "no event name",
  SPORT_DATE_SHELL: "name is only a sport and a date — an ingestion shell, not an event",
  NO_PROMOTION_NO_BOUTS: "no promotion and no bouts — nothing identifies this card",
  PAST_WITH_NO_BOUTS: "finished, but no bouts were ever ingested — nothing to show",
  NO_DATE: "no usable date",
};

/**
 * A name that is just "<Sport> — <date>" carries no information the date column
 * does not already have. Matches the en/em dash and hyphen forms, because the
 * generators that produce these are not consistent about it.
 */
const SPORT_DATE_SHELL =
  /^\s*(boxing|mma|mixed martial arts|kickboxing|muay thai|bare knuckle|bkfc|wrestling|judo|bjj|sambo|taekwondo|karate)\s*[-–—]\s*\d{1,2}\s+\w+(\s+\d{4})?\s*$/i;

const isBlank = (s: string | undefined | null): boolean => !s || s.trim().length === 0;

/**
 * Why this event should not be listed, or null when it is fine to show.
 *
 * Returning the REASON rather than a boolean is deliberate: a silent filter is
 * how you end up unable to explain why a promotion looks thin. Callers log it.
 */
export function eventSkipReason(
  event: Pick<FightEvent, "name" | "promotion" | "date" | "fights" | "sport">,
  now: Date = new Date(),
): SkipReason | null {
  if (isBlank(event.name)) return "NO_NAME";
  if (SPORT_DATE_SHELL.test(event.name)) return "SPORT_DATE_SHELL";

  const when = new Date(event.date);
  if (Number.isNaN(when.getTime())) return "NO_DATE";

  const boutCount = event.fights?.length ?? 0;

  // Nothing but a bare name: no promotion to attribute it to and no bouts to
  // read. There is no version of this card that helps anyone.
  if (isBlank(event.promotion) && boutCount === 0) return "NO_PROMOTION_NO_BOUTS";

  // A finished card with no bouts is a dead end — the reader arrives expecting
  // results and finds an empty page. Upcoming is the opposite: the card simply
  // is not announced yet, which is worth following.
  if (boutCount === 0 && when.getTime() <= now.getTime()) return "PAST_WITH_NO_BOUTS";

  return null;
}

/** The predicate every listing surface should use. */
export function isRenderableEvent(
  event: Pick<FightEvent, "name" | "promotion" | "date" | "fights" | "sport">,
  now: Date = new Date(),
): boolean {
  return eventSkipReason(event, now) === null;
}

export interface FilterOutcome<T> {
  events: T[];
  skipped: { name: string; reason: SkipReason }[];
}

/**
 * Filter a list and keep what was dropped, so a caller can log it.
 *
 * The skipped rows are returned rather than logged in here: this module is
 * client-safe and has no business choosing a logger.
 */
export function filterRenderableEvents<
  T extends Pick<FightEvent, "name" | "promotion" | "date" | "fights" | "sport">,
>(events: T[], now: Date = new Date()): FilterOutcome<T> {
  const kept: T[] = [];
  const skipped: { name: string; reason: SkipReason }[] = [];
  for (const e of events) {
    const reason = eventSkipReason(e, now);
    if (reason) skipped.push({ name: e.name || "(unnamed)", reason });
    else kept.push(e);
  }
  return { events: kept, skipped };
}

/**
 * True when the card is real but its bouts are not published yet — the state a
 * surface should LABEL ("card to be announced") rather than hide.
 */
export function isAwaitingCard(
  event: Pick<FightEvent, "date" | "fights">,
  now: Date = new Date(),
): boolean {
  return (event.fights?.length ?? 0) === 0 && new Date(event.date).getTime() > now.getTime();
}
