// ════════════════════════════════════════════════════════════════════════════
//  "TBA" is not a person. ONE definition, PURE.
//
//  Promotions and bookmakers announce a bout before the opponent is signed, and
//  they fill the empty side with a word: "TBA", "Opponent TBA", "TBD", "To Be
//  Announced". Every ingest path takes competitor names verbatim, so without a
//  guard that word is upserted as a Fighter — it gets a row, a slug, a profile
//  page, a record of 0-0-0, and a place in the sitemap. Worse, every future
//  placeholder bout collapses onto the SAME slug, because they all share a name,
//  so "tba" accumulates bouts across unrelated cards and promotions.
//
//  The audit found the downstream damage: 15 placeholder URLs in the sitemap,
//  "TBA vs Opponent TBA" discussion threads in the forums, and event cards
//  linking the word "TBA" to a fighter profile as though a crawler or a reader
//  should follow it.
//
//  The rule was already written and correct — inside lib/odds/provider.ts, where
//  only the odds pipeline could reach it. It lives here now because the question
//  "is this a real person?" is asked by ingest, routing, metadata, sitemap
//  generation and community-thread creation alike, and they must not answer it
//  differently.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Names that mean "nobody yet".
 *
 * Anchored, so a real fighter is never caught by it: this matches the WHOLE
 * name, not a substring. That matters — "Tba" appears inside real surnames, and
 * fighters are genuinely nicknamed "The Unknown". A bout between two people
 * whose names merely CONTAIN these letters is a real bout.
 */
const PLACEHOLDER_NAME =
  /^(opponent\s+)?(tba|tbd|tbc|t\.b\.a\.?|t\.b\.d\.?|to\s+be\s+(announced|advised|confirmed|determined|named)|unknown|unnamed|opponent|vacant|n\/?a)$/i;

/** True when this name is a placeholder for an unannounced opponent. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true; // an unnamed corner is not a person either
  return PLACEHOLDER_NAME.test(name.trim());
}

/**
 * The slug form, for call sites that only hold a slug (routing, sitemap
 * filtering). Slugs are lowercased and hyphenated, so "Opponent TBA" arrives as
 * "opponent-tba" and the word boundaries are hyphens rather than spaces.
 */
export function isPlaceholderSlug(slug: string | null | undefined): boolean {
  if (!slug) return true;
  return isPlaceholderName(slug.replace(/-/g, " "));
}

/**
 * A bout is REAL only when both corners are named. Used to decide whether a bout
 * deserves a route, a sitemap entry, a discussion thread or a pick control —
 * everything that treats a matchup as an established fact.
 */
export function isRealBout(redName: string | null | undefined, blueName: string | null | undefined): boolean {
  return !isPlaceholderName(redName) && !isPlaceholderName(blueName);
}
