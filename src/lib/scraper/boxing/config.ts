// ════════════════════════════════════════════════════════════════════════════
//  BOXING — the source registry, and the capability ladder behind it.
//
//  Boxing was the platform's largest gap: 20 events against 573 MMA, only 8 of
//  them with bouts, and every one attributed to Misfits or to nothing. Canelo,
//  Crawford, Usyk and Inoue existed ONLY as surname-only ranking stubs with zero
//  bouts; Shakur Stevenson and David Benavidez did not exist at all.
//
//  The cause was not a broken importer or a filter. There was no boxing event
//  provider of any kind, so there was nothing to audit. This registry is the
//  first one, and it is written so that adding a source later is a config entry
//  rather than an architecture change.
//
//  ── WHY BOXING NEEDS ITS OWN DISCOVERY SHAPE ──────────────────────────────
//
//  The two Wikipedia shapes this codebase already reads do not exist for boxing:
//
//    • per-promotion INDEX article (Misfits) — boxing has no single promoter
//      whose article indexes the sport;
//    • YEAR ROUND-UP ("2025 in Glory") — VERIFIED MISSING 2026-08-02. There is
//      no "2025 in boxing", "2026 in boxing", "List of boxing matches in 2025"
//      or "2025 in professional boxing" article. All four are redlinks.
//
//  What boxing HAS is a per-fight article for every notable card
//  ("Canelo Álvarez vs. Terence Crawford"), enumerated by CATEGORY. That is a
//  third discovery shape — category membership rather than a table or a page
//  split — and it is what this provider implements. Each member article carries
//  the standard infobox + results table the existing wikicard extractor and
//  pageMeta() already read, so discovery is the only new capability.
// ════════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";

export interface CategorySource {
  key: string;
  /** Category title template; `{year}` is substituted. No "Category:" prefix. */
  categoryTemplate: string;
  sport: Sport;
  /**
   * Stored as Event.promotion when the card's own infobox names none. Null
   * leaves it unattributed rather than inventing a promoter — a boxing card is
   * routinely co-promoted, and guessing one is worse than leaving it blank.
   */
  promotion: string | null;
  /** Earliest year worth probing. Later years are probed and may be empty. */
  firstYear: number;
  scheduledRounds: number;
  sourceLadder: string;
}

export const CATEGORY_SOURCES: CategorySource[] = [
  {
    key: "boxing",
    categoryTemplate: "{year} boxing matches",
    sport: "BOXING",
    promotion: null,
    firstYear: 2015,
    scheduledRounds: 12,
    sourceLadder:
      "Checked 2026-08-02. (1) No annual round-up: '2025 in boxing', '2026 in boxing', " +
      "'List of boxing matches in 2025' and '2025 in professional boxing' are ALL redlinks, " +
      "so the year-page path that yielded 127 GLORY events cannot be used. (2) ESPN's boxing " +
      "site-API scoreboard is a 404 (already recorded in promotion-index/config). (3) " +
      "'Category:{year} boxing matches' EXISTS and enumerates the notable cards as per-fight " +
      "articles — measured 2025: 15 members including Canelo Álvarez vs. Terence Crawford, " +
      "Oleksandr Usyk vs. Daniel Dubois II, Artur Beterbiev vs. Dmitry Bivol II, Chris Eubank " +
      "Jr vs Conor Benn, Ryan Garcia vs. Rolando Romero and Manny Pacquiao vs. Mario Barrios. " +
      "Those are precisely the fights the platform was missing. Each article carries one " +
      "infobox (date/venue/location) plus a results table in the shape parseWikiCard already " +
      "reads. CC BY-SA, attribution rendered.",
  },
];

export const categorySourceFor = (key: string): CategorySource | undefined =>
  CATEGORY_SOURCES.find((s) => s.key === key.toLowerCase());

export const categoryTitle = (s: CategorySource, year: number): string =>
  s.categoryTemplate.replace("{year}", String(year));

// ════════════════════════════════════════════════════════════════════════════
//  TIER 1 — official promotion sites. Capability probed 2026-08-02.
//
//  Recorded whether or not a provider was built, because "we looked and this is
//  what it publishes" is the expensive part, and the next person should not have
//  to repeat it. `status` is a decision, not a to-do list:
//
//    supported     — structured data exists; a provider can be written.
//    thin          — crawlable and server-rendered, but publishes materially
//                    less than we already hold. Building it would add requests
//                    and no facts.
//    unprobed      — not yet checked.
//    unsupported   — client-rendered only, or terms forbid it.
// ════════════════════════════════════════════════════════════════════════════

export interface PromoterCapability {
  name: string;
  site: string;
  robots: string;
  sitemap: string | null;
  structuredData: string;
  status: "supported" | "thin" | "unprobed" | "unsupported";
  note: string;
}

export const BOXING_PROMOTERS: PromoterCapability[] = [
  {
    name: "Matchroom Boxing",
    site: "https://www.matchroomboxing.com",
    robots: "crawlable — WooCommerce/admin paths disallowed, content allowed",
    sitemap: "https://www.matchroomboxing.com/events-sitemap.xml",
    structuredData: "none — no JSON-LD; server-rendered WordPress HTML",
    status: "thin",
    note:
      "381 event URLs in a dedicated events sitemap, /events/{a}-vs-{b}/, spanning 2021–2026 — " +
      "excellent DISCOVERY. But the event page itself carries only the headline bout and a " +
      "one-line result ('Canelo retains Middleweight Titles 115-113, …'): no undercard, no " +
      "venue, no broadcaster. Wikipedia already gives us the full card WITH the undercard for " +
      "the same fights, so scraping this adds 381 requests and no bouts. Revisit if Matchroom " +
      "ever publishes JSON-LD or a card listing — the sitemap makes it a one-config-entry job.",
  },
  {
    name: "Top Rank",
    site: "https://toprank.com",
    robots: "fully crawlable — 'Disallow:' empty",
    sitemap: "https://toprank.com/sitemap.xml",
    structuredData: "unprobed",
    status: "unprobed",
    note: "robots.txt permits everything and declares a sitemap. Next candidate after this provider ships.",
  },
  {
    name: "Premier Boxing Champions",
    site: "https://www.premierboxingchampions.com",
    robots: "crawlable, Crawl-delay: 10 (Drupal)",
    sitemap: "https://www.premierboxingchampions.com/sites/default/files/google-sitemap/gs-index.xml",
    structuredData: "unprobed",
    status: "unprobed",
    note:
      "The 10-second crawl delay is a published rate limit and must be honoured — at that rate a " +
      "full pass is hours, so it suits a slow background sweep rather than a cron tick.",
  },
  {
    name: "Golden Boy Promotions",
    site: "https://www.goldenboypromotions.com",
    robots: "fully crawlable — 'Disallow:' empty, no sitemap declared",
    sitemap: null,
    structuredData: "unprobed",
    status: "unprobed",
    note: "No sitemap declared, so discovery would need link-walking — more brittle than the others.",
  },
  {
    name: "Queensberry Promotions",
    site: "https://queensberry.com",
    robots: "unprobed",
    sitemap: null,
    structuredData: "unprobed",
    status: "unprobed",
    note: "Not yet checked.",
  },
];
