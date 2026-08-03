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
  {
    key: "adcc",
    article: "ADCC Submission Fighting World Championship",
    promotion: "ADCC",
    sport: "BJJ",
    // Submission grappling has no rounds; a single timed match.
    scheduledRounds: 1,
    sourceLadder:
      "Checked 2026-08-03. (1) No official API. (2) adcombat.com — the provider in " +
      "lib/scraper/adcc — answers HTTP 403 to our bot User-Agent. MEASURED: it serves " +
      "200 to any UA beginning 'Mozilla/5.0' and 403 to both 'curl/8.0' and our bot " +
      "string, so it is a generic WAF UA filter, not a targeted refusal. We do not " +
      "spoof a browser to defeat it (see lib/http-identity), so that path yields " +
      "nothing and the syncADCC harvest returns 0 events with a 'blocked: 403' " +
      "warning. (3) ESPN carries no grappling league. (4) Wikipedia. " +
      "MEASURED YIELD 2026-08-03: ZERO index rows, and the reason is structural. " +
      "This article has no numbered event index at all — none of the 46 tables on it " +
      "is a '# | Event | Date | Venue' listing. They are MEDAL TABLES: one per " +
      "edition, giving winner / 2nd / 3rd per weight class and nothing else. Only two " +
      "editions link to a card article of their own (2022 and 2024); every edition " +
      "from 1998 onward is a medal table and no more. There is no bout-by-bout result " +
      "for ADCC on Wikipedia to parse, so there is nothing here for this path or any " +
      "other to read. " +
      "That makes BJJ a SOURCE gap, not a parser gap — the same conclusion the " +
      "tournament provider reached for sambo. adcombat.com holds the real data and " +
      "refuses our bot; Wikipedia holds medal tables. Bringing BJJ to parity with MMA " +
      "or boxing needs manual entry or a licensed grappling data provider, and no " +
      "amount of scraper work reaches it. Recorded here so the next person does not " +
      "repeat the search.",
    /**
     * Disabled on the evidence above: the run costs one request and returns zero
     * rows every time. Kept registered because the ladder IS the finding — deleting
     * the entry would leave "why is there only one BJJ event?" unanswered again.
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

// ════════════════════════════════════════════════════════════════════════
//  MUAY THAI — the source ladder, walked 2026-08-02. Read this before adding
//  a Muay Thai scraper; four of the obvious candidates are dead ends and the
//  fifth was already being ingested under the wrong sport.
//
//  ONE Friday Fights / ONE Lumpinee — SOLVED, no new provider needed.
//    ONE's Muay Thai and kickboxing series at Lumpinee. Already read by the
//    `one` year-page source above (Wikipedia's "List of ONE Championship
//    events" counts 347 ONE + ONE Friday Fights cards, and the year round-ups
//    carry them). They were stored as MMA because this config pins one sport
//    per promotion. ONE states each bout's ruleset inside the weight class
//    ("Featherweight Muay Thai", "Women's Atomweight Kickboxing" — verified on
//    ONE Friday Fights 46), so the card's sport is now DERIVED from its bouts.
//    See lib/scraper/ruleset. This is the project's largest Muay Thai corpus
//    and it cost no new requests.
//
//  Rajadamnern Stadium / Rajadamnern World Series (RWS) — NO SOURCE.
//    RWS has no article of its own. A search returns only fighter biographies
//    that mention competing on it ("Rajadamnern World Series debut", tournament
//    titles). "Rajadamnern Stadium" is a venue article with no event index.
//    There is nothing to parse. Revisit only if an RWS article appears.
//
//  Thai Fight — INDEX EXISTS, NO BOUTS.
//    The "Thai Fight" article carries a 106-row table, # | Event | Date | Venue
//    | City, covering 2010-08-29 to 2025-06-08. But the Event names DO NOT LINK
//    to per-card articles (only venues and cities are linked), and the index
//    path needs a linked card article to extract results from. Running it would
//    add 106 EMPTY CARDS — the exact failure the `disabled` flag exists for, and
//    worse than showing the promotion as uncovered. Needs a different capability
//    (a source that publishes Thai Fight results), not a config entry.
//
//  Max Muay Thai — NO SOURCE.
//    The article is prose: History, Notable competitors, References. No event
//    table in any form.
//
//  Lumpinee Boxing Stadium, Bangla Boxing Stadium, Super Champ Muay Thai —
//    venue and programme articles surfaced by search; none carries an event
//    index table. Not registered.
//
//  Still unchecked, in rough order of likely yield: RWS's own site (rwsmuaythai
//  .com) for a JSON endpoint, Thai Fight's official site, and whether ONE's
//  numbered cards' Muay Thai title bouts are now correctly split out by the
//  ruleset derivation above.
// ════════════════════════════════════════════════════════════════════════

export const yearPageTitle = (s: YearPageSource, year: number): string =>
  s.titleTemplate.replace("{year}", String(year));
