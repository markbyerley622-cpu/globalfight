// ════════════════════════════════════════════════════════════════════════
//  Promotions whose card history is only obtainable from their Wikipedia index.
//
//  A promotion earns an entry here ONLY after the source ladder has been walked
//  and lost: no official API, no public JSON endpoint, no embedded JSON. The
//  `sourceLadder` note on each entry records what was actually checked, so the
//  next person does not repeat the search — and so a promotion that later ships
//  an API can be moved off this path with the evidence in hand.
// ════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";

export interface PromotionIndexSource {
  key: string;
  /** The Wikipedia article carrying the numbered event index. */
  article: string;
  /** Stored as Event.promotion — must match the promotions registry name. */
  promotion: string;
  sport: Sport;
  /** Rounds a bout is scheduled for when the card does not say. */
  scheduledRounds: number;
  /** What was checked before choosing this path. */
  sourceLadder: string;
}

export const PROMOTION_INDEX_SOURCES: PromotionIndexSource[] = [
  {
    key: "misfits",
    article: "Misfits Boxing",
    promotion: "Misfits Boxing",
    sport: "BOXING",
    scheduledRounds: 5,
    sourceLadder:
      "Checked 2026-08-01. (1) No official API. (2) ESPN carries no Misfits: it is absent " +
      "from all 48 ESPN MMA leagues and all 400 boxing leagues, and ESPN's boxing site-API " +
      "scoreboard is a 404 — so there is no ESPN mapping to add. (3) misfitsboxing.com is a " +
      "Shopify storefront: no __NEXT_DATA__, no Apollo state, no JSON-LD, and its /robots.txt " +
      "returns the HTML shop page. (4) Wikipedia maintains a 32-row numbered index of every " +
      "card, each row linking to that card's own article carrying a standard results table " +
      "the existing wikicard extractor already reads. CC BY-SA, attribution rendered.",
  },
];

export const indexSourceFor = (key: string): PromotionIndexSource | undefined =>
  PROMOTION_INDEX_SOURCES.find((s) => s.key === key.toLowerCase());
