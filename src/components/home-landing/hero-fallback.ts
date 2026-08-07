import type { HeroEvent } from "./data";

/**
 * How the hero picks its card, and what it shows when there is no card to pick.
 *
 * Split out of `data.ts` — which is `server-only` and holds a live Prisma client
 * — so both halves can be tested as pure functions. The rule for choosing a
 * featured event and the shape of the stand-in are exactly the parts most worth
 * pinning: one decides whether the page still works tomorrow, the other decides
 * whether an empty database produces a quiet page or a broken-looking one.
 */

/** The minimum an event row needs before this module will consider it. */
export interface Candidate {
  id: string;
  mainEvent: { red: string; blue: string } | null;
}

/**
 * The featured card, by a STABLE RULE rather than by id.
 *
 * Preference order — soonest first within each tier, because the caller queries
 * upcoming events in date order:
 *
 *   1. a card with a headline bout and both corners named
 *   2. a card with a headline bout at all
 *   3. any card
 *
 * Hard-coding one event's id would make the hero a time bomb: the card happens,
 * the ingest moves it to COMPLETED, and the page's largest element becomes an
 * empty box on a Sunday morning. This way the next card simply takes its place
 * and nothing about the layout changes.
 */
export function pickHero<T extends Candidate>(events: T[]): T | null {
  return (
    events.find((e) => e.mainEvent && e.mainEvent.red && e.mainEvent.blue) ??
    events.find((e) => e.mainEvent) ??
    events[0] ??
    null
  );
}

/**
 * The stand-in, for an empty or unreachable database.
 *
 * Deliberately carries NO date, NO venue, NO record and NO slug. A fabricated
 * fight card is the one thing a fight calendar cannot be caught publishing, so
 * this says what it is — the component renders `placeholder` cards with an
 * "example card" line, without a countdown and without a link — rather than
 * inventing a plausible-looking bout. The epoch date is never rendered; it
 * exists only so the type stays a string.
 */
export const FALLBACK_HERO: HeroEvent = {
  slug: null,
  name: "Fight night",
  promotion: "Every major promotion",
  sport: "MMA",
  date: new Date(0).toISOString(),
  venue: null,
  location: null,
  broadcaster: null,
  boutCount: 0,
  titleFight: false,
  red: { name: "Red corner", slug: null, record: "", rank: null },
  blue: { name: "Blue corner", slug: null, record: "", rank: null },
  crowd: null,
  placeholder: true,
};

/**
 * Whole-percent crowd split, or null.
 *
 * Null when nobody has called it — a 50/50 bar that nobody voted for is a made-up
 * statistic, and this page must not carry one. The two halves are forced to total
 * 100 by deriving blue from red, so rounding can never leave a one-pixel gap or a
 * bar that overflows its track.
 */
export function crowdSplit(crowd: { red: number; total: number } | null | undefined) {
  if (!crowd || crowd.total <= 0) return null;
  const red = Math.round((crowd.red / crowd.total) * 100);
  return { red, blue: 100 - red, total: crowd.total };
}
