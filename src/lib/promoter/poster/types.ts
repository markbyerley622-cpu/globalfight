// Client- and server-safe contract for poster extraction.
//
// Separate from the OCR seam (which is server-only — it holds provider
// credentials) because the REVIEW step is a client surface: it renders every
// extracted field with its confidence and lets the promoter correct it. The
// wizard needs these shapes without dragging a provider SDK into the browser.

/**
 * One line of text an OCR provider found on the poster.
 *
 * The shape is the intersection of what every provider returns, so no adapter
 * has to invent data. `box` and `confidence` are optional because a provider
 * that gives neither (a plain text-dump, or a promoter pasting the poster's
 * text by hand) must still work — the parser degrades to ordering and pattern
 * matching rather than refusing.
 */
export interface OcrLine {
  text: string;
  /** Provider's own 0–1 confidence for this line, when it reports one. */
  confidence?: number;
  /**
   * Normalised 0–1 rectangle. `height` is the useful part: on a fight poster,
   * type size IS hierarchy — the biggest line is the event name and the next
   * biggest are the main-event fighters.
   */
  box?: { top: number; left: number; width: number; height: number };
}

export interface OcrResult {
  lines: OcrLine[];
  /** Which adapter produced this, for provenance and debugging. */
  provider: string;
}

/**
 * A single extracted value, with what it came from.
 *
 * Every field the promoter sees carries this rather than a bare value, because
 * the review step's whole job is to let them fix the wrong ones FAST — and to
 * do that it has to show which are shaky. A draft of plain strings looks
 * equally authoritative whether it was read off 40pt type or guessed.
 */
export interface Extracted<T> {
  value: T;
  /** 0–1. Below LOW_CONFIDENCE the UI should flag it for a look. */
  confidence: number;
  /** The poster line this was read from. Shown as evidence. */
  source: string;
}

/** Below this, the review step marks a field as needing a human look. */
export const LOW_CONFIDENCE = 0.7;

export interface ExtractedBout {
  redName: Extracted<string>;
  blueName: Extracted<string>;
  /**
   * Position on the card, 0-based. Derived from type size where the provider
   * gives geometry, otherwise from reading order.
   */
  orderOnCard: number;
  /** The largest bout on the poster. Exactly one, when there is any bout. */
  mainEvent: boolean;
  weightClass: Extracted<string> | null;
  titleFight: boolean;
}

export interface PosterDraft {
  eventName: Extracted<string> | null;
  /** Registry slug, when the poster names a promotion we already know. */
  promotionSlug: Extracted<string> | null;
  /** Calendar date only. The time is separate — posters print several. */
  date: Extracted<{ year: number; month: number; day: number; yearInferred: boolean }> | null;
  doorsAt: Extracted<{ hour: number; minute: number }> | null;
  firstBellAt: Extracted<{ hour: number; minute: number }> | null;
  /** As PRINTED, never resolved to an offset — see date.ts. */
  timezoneAbbr: string | null;
  venue: Extracted<string> | null;
  city: Extracted<string> | null;
  countryCode: Extracted<string> | null;
  bouts: ExtractedBout[];
  /**
   * Lines we could not place.
   *
   * Surfaced, not swallowed. A poster carries sponsor logos, ticket URLs,
   * broadcast partners and taglines, and the promoter is the only one who knows
   * which leftover line was the thing we should have caught. Hiding them makes
   * every extraction miss look like the poster simply did not say it.
   */
  unmatchedLines: string[];
}
