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
  /**
   * Registered but not run. Used when the ladder found a real index that yields
   * no attributable BOUTS — running it would add empty cards, which is worse than
   * showing the sport as unsupported. The sourceLadder records why.
   */
  disabled?: boolean;
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
  {
    key: "glory",
    article: "Glory (kickboxing)",
    promotion: "GLORY",
    sport: "KICKBOXING",
    // Three rounds of three minutes, plus a possible extra round.
    scheduledRounds: 3,
    sourceLadder:
      "Checked 2026-08-01. (1) No official API. (2) ESPN has no GLORY league — every " +
      "slug tried returned HTTP 400, and ESPN's boxing scoreboard is a 404. (3) " +
      "glorykickboxing.com is a Nuxt app: no __NEXT_DATA__, no JSON-LD, no Apollo " +
      "state; its robots.txt is permissive but the payload is __NUXT__ hydration " +
      "state, which is a scrape rather than a feed. (4) The 'Glory (kickboxing)' " +
      "article carries a 127-row event index — # | Event | Date | Venue | Location | " +
      "Attendance — the same header shape the Misfits index uses. CC BY-SA, " +
      "attribution rendered. This is the ONLY kickboxing source in the project: " +
      "ESPN files ONE's kickboxing bouts under MMA because its payload carries a " +
      "weight class but never a ruleset. " +
      "MEASURED YIELD 2026-08-01: 206 index rows, 0 usable cards. 140 rows link to a " +
      "YEAR round-up ('2025 in Glory') rather than their own article, so the " +
      "shared-article guard refuses them — correctly, since otherwise every Glory " +
      "card would claim the whole season's bouts. 21 rows have no article at all and " +
      "45 no parseable date (the article's champion-history tables also carry " +
      "Event+Date columns and are picked up as index tables). Extracting Glory bouts " +
      "needs a YEAR-PAGE SPLITTER that sections a round-up by event heading — a new " +
      "capability, not a config entry. Left registered so the ladder is on record " +
      "and the next attempt starts from here. " +
      "RESOLVED 2026-08-02: the splitter now exists (year-split.ts) and Glory moved to " +
      "the YEAR_PAGE_SOURCES path below — 127 events, 1,443 bouts, 1,406 decided, 0 " +
      "sections skipped.",
    /**
     * Stays disabled, for a NEW reason: the 140 rows this path refuses are the same
     * cards the year path now reads, so running both would have them fight over the
     * same events. Kept registered because the ladder above is the evidence for why
     * Glory is read the way it is.
     */
    disabled: true,
  },
];

export const indexSourceFor = (key: string): PromotionIndexSource | undefined =>
  PROMOTION_INDEX_SOURCES.find((s) => s.key === key.toLowerCase());

// ════════════════════════════════════════════════════════════════════════
//  Promotions whose cards are only written up on YEAR ROUND-UP pages.
//
//  A different source shape from the one above, so a different list. The index
//  path wants one article per card; these promotions have none — every card they
//  ran in a year shares a single article, which is why the index path's
//  shared-article guard refuses all of them. See year-split.ts.
// ════════════════════════════════════════════════════════════════════════

export interface YearPageSource {
  key: string;
  /** Article title template; `{year}` is substituted. */
  titleTemplate: string;
  /** Stored as Event.promotion — must match the promotions registry name. */
  promotion: string;
  sport: Sport;
  /** Earliest year with a round-up page. Later years are probed and may 404. */
  firstYear: number;
  sourceLadder: string;
}

export const YEAR_PAGE_SOURCES: YearPageSource[] = [
  {
    key: "one",
    titleTemplate: "{year} in ONE Championship",
    promotion: "ONE Championship",
    sport: "MMA",
    firstYear: 2011,
    sourceLadder:
      "Checked 2026-08-02. ONE has no per-card Wikipedia article: searching for a card " +
      "by any name form — full, reduced, or with the broadcast suffix stripped — returns " +
      "the same year round-up, which the wikicard verifier then rejects (correctly). " +
      "The round-up carries one infobox + results table per card, the same table shape " +
      "parseWikiCard already reads. ESPN covers ONE's MMA bouts but files its Muay Thai " +
      "and kickboxing under MMA because the payload has no ruleset field, so ESPN cannot " +
      "close this gap. CC BY-SA, attribution rendered.",
  },
  {
    key: "glory",
    titleTemplate: "{year} in Glory",
    promotion: "GLORY",
    sport: "KICKBOXING",
    firstYear: 2012,
    sourceLadder:
      "Checked 2026-08-02. Supersedes the disabled index-path entry: the 140 index rows " +
      "that pointed at a year round-up are exactly what this path reads. Measured on the " +
      "2025 page — 9 cards, 118 bouts, 116 decided, 0 skipped. This is the ONLY kickboxing " +
      "source in the project.",
  },
];

export const yearSourceFor = (key: string): YearPageSource | undefined =>
  YEAR_PAGE_SOURCES.find((s) => s.key === key.toLowerCase());

export const yearPageTitle = (s: YearPageSource, year: number): string =>
  s.titleTemplate.replace("{year}", String(year));
