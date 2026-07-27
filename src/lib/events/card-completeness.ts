// ════════════════════════════════════════════════════════════════════════════
//  WHY does this event have no bouts? PURE.
//
//  An event page with zero fights reached production saying nothing at all — a
//  "Fight card" heading, a 0 badge, and empty space. The reader cannot tell whether
//  the promotion has not announced the card, whether we do not cover that promotion,
//  or whether something on our side broke. All three look identical, and the last one
//  looks like the site is broken.
//
//  The fix is not better copy for one case. It is admitting that "no bouts" is
//  several DIFFERENT states with different truths and different next actions, and
//  deciding which one applies before rendering anything.
//
//  Pure so it is unit-testable and so the same classification can drive an internal
//  completeness metric as well as the empty state a reader sees.
// ════════════════════════════════════════════════════════════════════════════

export type CardState =
  /** Bouts exist. Nothing to explain. */
  | "COMPLETE"
  /** The promotion genuinely has not announced the matchups yet. */
  | "CARD_NOT_RELEASED"
  /** We cover this promotion; the importer has not reached this event yet. */
  | "INGESTION_PENDING"
  /** No configured provider covers this promotion at all. */
  | "PROVIDER_MISSING"
  /** A provider gave us this event but no bouts came through with it. */
  | "EXTRACTION_FAILED"
  /** The event is off. Distinct from missing data. */
  | "CANCELLED";

export interface CardContext {
  boutCount: number;
  status: string;
  /** The event's own date. */
  date: Date;
  /** Registry slug, or null when the promotion is unknown/"Various". */
  promotionSlug: string | null;
  /**
   * Does a configured, ENABLED source cover this promotion or sport?
   *
   * Passed in rather than computed here, because the answer lives in the ingestion
   * registry and the provider registry — two server-only modules this file must not
   * depend on if it is to stay pure and testable.
   */
  covered: boolean;
  /**
   * Did an importer already write bouts for this event and then lose them, or import
   * the event itself from a source that should have carried a card?
   *
   * True when the event has provenance (a FightImport or an ExternalId) but no bouts:
   * that combination means a provider DID hand us this event and the card did not
   * survive, which is our bug and not the promotion's silence.
   */
  hasProviderProvenance: boolean;
  now?: Date;
}

/** Cards are typically announced well ahead; this far out, silence is normal. */
const ANNOUNCE_WINDOW_DAYS = 45;

export function classifyCard(ctx: CardContext): CardState {
  if (ctx.boutCount > 0) return "COMPLETE";

  // Cancellation wins over everything. A called-off event has no card and never
  // will, and telling someone we are "still importing" would be a lie.
  if (ctx.status === "CANCELLED") return "CANCELLED";

  // A provider handed us the event but no bouts. That is OUR failure, and saying
  // "not announced yet" would blame the promotion for our mapping.
  if (ctx.hasProviderProvenance) return "EXTRACTION_FAILED";

  if (!ctx.covered) return "PROVIDER_MISSING";

  // Covered, no provenance, and the event has started or is imminent — the importer
  // should have had it by now.
  const now = ctx.now ?? new Date();
  const daysAway = (+ctx.date - +now) / 86_400_000;
  if (daysAway <= 2) return "INGESTION_PENDING";

  // Covered and still comfortably ahead: the promotion has simply not published the
  // matchups. This is the common, innocent case.
  if (daysAway <= ANNOUNCE_WINDOW_DAYS) return "CARD_NOT_RELEASED";

  return "CARD_NOT_RELEASED";
}

export interface CardStateCopy {
  title: string;
  body: string;
  /** Does the reader gain anything by following? Not for a cancelled card. */
  offerFollow: boolean;
  /** True when the cause is on OUR side — surfaced differently to operators. */
  ourFault: boolean;
}

/**
 * What to tell the reader. Honest per state, and never blames the promotion for our
 * own gap or vice versa.
 */
export function cardStateCopy(state: CardState): CardStateCopy {
  switch (state) {
    case "CANCELLED":
      return {
        title: "This event was cancelled",
        body: "It was called off before a full card was announced.",
        offerFollow: false,
        ourFault: false,
      };
    case "CARD_NOT_RELEASED":
      return {
        title: "Bout card has not been announced yet",
        body: "The date is confirmed but the matchups aren't. Follow the event and we'll tell you the moment bouts are added.",
        offerFollow: true,
        ourFault: false,
      };
    case "INGESTION_PENDING":
      return {
        title: "We're still importing this card",
        body: "This event is covered by one of our sources and the card should appear shortly. Follow it and we'll notify you.",
        offerFollow: true,
        ourFault: true,
      };
    case "EXTRACTION_FAILED":
      return {
        // Deliberately does NOT say "not announced": we know a source had this event,
        // so the honest statement is that the card is missing on our side.
        title: "We couldn't load this card",
        body: "Our source has this event but the bouts didn't come through. We're on it — follow the event and we'll notify you when it's fixed.",
        offerFollow: true,
        ourFault: true,
      };
    case "PROVIDER_MISSING":
      return {
        title: "This promotion isn't fully supported yet",
        body: "We track the event, but we don't have a bout-level source for this promotion. If you know the card, tell us and we'll add it.",
        offerFollow: true,
        ourFault: true,
      };
    case "COMPLETE":
    default:
      return { title: "", body: "", offerFollow: false, ourFault: false };
  }
}

/**
 * A 0-100 completeness score for internal monitoring.
 *
 * Weighted by what a READER came for, not by how many columns are populated: the
 * card is most of the value of an event page, so an event with a venue, a broadcaster
 * and no bouts should score low rather than middling.
 */
export interface CompletenessInput {
  boutCount: number;
  hasVenue: boolean;
  hasBroadcast: boolean;
  hasPoster: boolean;
  hasResults: boolean;
  hasOdds: boolean;
  isPast: boolean;
}

/**
 * Does any ENABLED source reach this promotion at bout level?
 *
 * A deliberate ALLOW-LIST keyed to the ingestion registry, not a guess. A promotion
 * absent from this list is one we do not import bouts for, and the reader is told
 * that plainly instead of being left to assume the card is late.
 *
 * Kept here as data rather than importing the registry, so this module stays pure —
 * and so adding coverage is one visible line next to the copy it changes.
 */
const BOUT_LEVEL_COVERAGE = new Set([
  // Scrapers enabled in lib/ingestion-registry.
  "bkfc",
  "one",
  "adcc",
  // Wikipedia card provider covers the majors it has pages for.
  "ufc",
  "bellator",
  "pfl",
]);

export function promotionCoveredBySlug(slug: string | null | undefined): boolean {
  return !!slug && BOUT_LEVEL_COVERAGE.has(slug);
}

export function completenessScore(i: CompletenessInput): number {
  let score = 0;
  // The card is 55 of the 100. Nothing else compensates for its absence.
  if (i.boutCount > 0) score += 45;
  if (i.boutCount >= 4) score += 10;
  if (i.hasVenue) score += 10;
  if (i.hasBroadcast) score += 8;
  if (i.hasPoster) score += 7;
  if (i.hasOdds) score += 8;
  // Results only count against a card that has actually happened — a future event is
  // not incomplete for lacking them.
  if (i.isPast) {
    if (i.hasResults) score += 12;
  } else {
    score += 12;
  }
  return Math.min(100, score);
}
