// ════════════════════════════════════════════════════════════════════════
//  Ingestion registry — the single, explicit list of external sources.
//
//  Rule: no source may run unless it is listed here AND enabled here. There is no
//  implicit ingestion. A source with no stated legal basis is not enabled, and
//  "we've always fetched it" is not a legal basis.
//
//  This exists because the project had accumulated ~10 scrapers nobody had a
//  contract for — including ranking tables lifted from five promotions, promotion
//  press photos, and a proof-of-work bypass — with no record of what was permitted.
// ════════════════════════════════════════════════════════════════════════

export type IngestionMethod = "licensed-api" | "public-api" | "rss-syndication" | "open-data" | "scrape";

export interface IngestionSource {
  id: string;
  /** Human name and the host we actually contact. */
  name: string;
  host: string;
  method: IngestionMethod;
  /**
   * The contractual or licensing basis. Must be a real, checkable statement.
   * "Public website" is NOT a basis.
   */
  basis: string;
  /** Fields we are permitted to take. Anything else must not be stored. */
  permittedFields: string[];
  /** How often it may run. */
  frequency: string;
  /** How long we may keep it. */
  retention: string;
  /** Attribution we are obliged to render, if any. */
  attribution: string | null;
  /** Nothing runs unless this is true. */
  enabled: boolean;
  /** Why it is off, when it is off. */
  note?: string;
}

export const INGESTION_SOURCES: IngestionSource[] = [
  // ── ENABLED ────────────────────────────────────────────────────────────
  {
    id: "wikipedia-facts",
    name: "Wikipedia / Wikidata (text facts only)",
    host: "en.wikipedia.org, wikidata.org",
    method: "open-data",
    basis: "CC BY-SA 4.0 (text) and CC0 (Wikidata). Reuse permitted with attribution.",
    permittedFields: [
      "name", "nationality", "record", "weightClass", "stance", "dateOfBirth",
      // Event fight cards + results (src/lib/scraper/wikicard). Same CC BY-SA text
      // grant; this is the only source carrying bout winners/method for BKFC/ONE,
      // which their own sites render client-side only.
      "eventCard(fighterNames)", "result", "method", "roundEnded", "titleFight",
    ],
    frequency: "daily",
    retention: "until superseded",
    attribution: "Text from Wikipedia, CC BY-SA 4.0.",
    enabled: true,
    note: "TEXT ONLY. Image re-hosting from Wikimedia is disabled — see MEDIA_INGESTION_ENABLED. " +
      "Wikimedia images carry per-file CC-BY/BY-SA terms we do not currently track, so we do not take them.",
  },
  {
    id: "news-rss",
    name: "Publisher RSS feeds (headlines + links)",
    host: "~60 publisher feeds",
    method: "rss-syndication",
    basis: "RSS is published for syndication. We take the headline, a short excerpt and the " +
      "canonical link, and send every reader to the publisher's own page.",
    permittedFields: ["title", "excerpt(<=300 chars)", "sourceUrl", "publishedAt", "sourceName"],
    frequency: "15 minutes",
    retention: "90 days",
    attribution: "Publisher name + link on every item.",
    enabled: true,
    note: "Cover images are NOT taken. Publisher imagery was previously hotlinked; it is now " +
      "replaced with locally generated category artwork.",
  },
  {
    id: "the-odds-api",
    name: "The Odds API",
    host: "api.the-odds-api.com",
    method: "licensed-api",
    basis: "Paid API. Terms permit caching and commercial user-facing display.",
    permittedFields: ["bookmaker", "price", "commenceTime"],
    frequency: "30 minutes",
    retention: "30 days",
    attribution: "Odds data by The Odds API. 18+ / responsible-gambling messaging required " +
      "wherever the data is displayed.",
    enabled: false,
    note: "INGESTED BUT NOT DISPLAYED. No UI renders these odds today. It stays disabled until " +
      "the 18+/RG messaging obligation is implemented on every surface that would show it.",
  },

  // ── DISABLED — no established basis ────────────────────────────────────
  {
    id: "ufcstats",
    name: "UFCStats / FightMetric",
    host: "ufcstats.com",
    method: "scrape",
    basis: "NONE.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "REMOVED. The site fronts every page with a JavaScript proof-of-work anti-bot gate, and " +
      "our scripts drove Chromium to solve it. Circumventing a technical access-control measure " +
      "is the classic CFAA fact pattern. Scripts and the Playwright dependency are deleted. " +
      "DO NOT REINSTATE.",
  },
  {
    id: "promotion-rankings",
    name: "UFC / BKFC / PFL / ONE / FightersRec / FloGrappling rankings",
    host: "ufc.com, bkfc.com, pflmma.com, onefc.com, fightersrec.com, flograppling.com",
    method: "scrape",
    basis: "NONE.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "REMOVED. A ranking table is an editorial compilation, not a fact — the classic UK/EU " +
      "database-right and copyright target. Scrapers deleted; existing rows purged via " +
      "`npm run rankings:purge-unlicensed`. Rankings stay off until a licensed source exists.",
  },
  {
    id: "promotion-photos",
    name: "Promotion press photography (ONE / BKFC / PFL / FightersRec)",
    host: "onefc.com, bkfc.com, pflmma.com, fightersrec.com",
    method: "scrape",
    basis: "NONE.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "REMOVED. Official press photography is a harder copyright class than user-contributed " +
      "imagery. Scrapers deleted.",
  },
  {
    id: "kalshi",
    name: "Kalshi",
    host: "api.elections.kalshi.com",
    method: "public-api",
    basis: "NONE. Their data terms forbid caching, third-party display, and commercial use.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED (KALSHI_ENABLED=false). Requires a market-data licence.",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    host: "gamma-api.polymarket.com, clob.polymarket.com",
    method: "public-api",
    basis: "NONE. Consumer ToS bars commercial use, public display, and scraping.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED (POLYMARKET_ENABLED=false). Requires a market-data licence.",
  },
  {
    id: "sportradar",
    name: "Sportradar",
    host: "api.sportradar.com",
    method: "licensed-api",
    basis: "Requires a signed Order Form. The client defaults to the TRIAL tier, which is " +
      "non-commercial and bans betting-related use.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: "\"Powered by Sportradar\" is MANDATORY if used — not currently rendered anywhere.",
    enabled: false,
    note: "Key-gated and unkeyed. Do not add a key until an Order Form is signed, " +
      "SPORTRADAR_ACCESS=production is set, and the attribution is implemented.",
  },
  {
    // The BKFC provider (src/lib/scraper/bkfc). Shipped DISABLED. The scraper
    // code is complete and gated so it runs only as a dry-run harvest until a
    // real basis is added here. These per-entity ids are what the ingest layer
    // checks (assertSourceEnabled) — they refine the older catch-all
    // "promotion-rankings"/"promotion-photos" entries below, which remain the
    // record that BKFC scraping was removed post-incident.
    id: "bkfc-events",
    name: "BKFC events & cards (bkfc.com)",
    host: "bkfc.com",
    method: "scrape",
    basis: "OPERATOR OVERRIDE (development), not an established legal basis. Enabled at the operator's " +
      "explicit instruction to ingest factual event data (date/venue/matchups). A written BKFC licence " +
      "or permission is still REQUIRED before production/public use — obtain one and replace this text.",
    permittedFields: ["name", "date", "venue", "city", "country", "posterUrl", "matchups(fighter names)", "titleFight"],
    frequency: "daily",
    retention: "until superseded",
    attribution: "Event data via BKFC (bkfc.com).",
    enabled: true,
    note: "ENABLED via operator override (dev). Requires ENABLE_SCRAPER=true. Bout RESULTS are not " +
      "scraped (not in static HTML). Rankings/news/photos remain disabled. Not a licence — see basis.",
  },
  {
    id: "bkfc-fighters",
    name: "BKFC fighter profiles (bkfc.com)",
    host: "bkfc.com",
    method: "scrape",
    basis: "OPERATOR OVERRIDE (development), not an established legal basis. Enabled at the operator's " +
      "explicit instruction to ingest factual fighter data (name, record, division, reach/height) AND " +
      "the profile headshot URL (stored as a source URL, served via /api/img, not re-hosted) — the " +
      "operator explicitly authorized promotion photos for dev, overriding 'promotion-photos'. A written " +
      "BKFC licence is still REQUIRED for production/public use.",
    permittedFields: ["name", "nickname", "record", "division", "heightCm", "reachCm", "nationality", "imageUrl"],
    frequency: "daily",
    retention: "until superseded",
    attribution: "Fighter data & headshots via BKFC (bkfc.com).",
    enabled: true,
    note: "ENABLED via operator override (dev). Requires ENABLE_SCRAPER=true. Headshot URL stored (photo " +
      "override authorized). Not a licence — see basis.",
  },
  {
    id: "bkfc-rankings",
    name: "BKFC divisional rankings (bkfc.com)",
    host: "bkfc.com",
    method: "scrape",
    basis: "NONE. A ranking table is an editorial compilation (database-right / copyright). Same " +
      "basis as the disabled 'promotion-rankings' entry.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED. Do not enable without a licensed rankings source.",
  },
  {
    id: "bkfc-news",
    name: "BKFC news articles (bkfc.com/news)",
    host: "bkfc.com",
    method: "scrape",
    basis: "NONE. /news is Disallow-ed in BKFC robots.txt. Requires syndication permission.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED. robots.txt disallows /news — do not enable without written permission.",
  },
  {
    id: "bkfc-videos",
    name: "BKFC videos (YouTube ids embedded on bkfc.com)",
    host: "bkfc.com, youtube.com",
    method: "scrape",
    basis: "NONE. Only YouTube video IDS (not media) would be stored, but still off pending review.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED.",
  },
  {
    // The ONE Championship provider (src/lib/scraper/one). Event schedule only,
    // driven by schema.org JSON-LD (date/venue/location). Refines the older
    // catch-all disabled onefc.com entries (promotion-rankings/photos) below.
    id: "one-events",
    name: "ONE Championship events (onefc.com)",
    host: "onefc.com",
    method: "scrape",
    basis: "OPERATOR OVERRIDE (development), not an established legal basis. Enabled at the operator's " +
      "explicit instruction to ingest factual event data (date/venue/location) for the schedule; the " +
      "'ONE Friday Fights' series maps to Muay Thai / kickboxing. A written ONE licence is still " +
      "REQUIRED for production/public use. robots.txt only disallows /wp-admin/.",
    permittedFields: ["name", "date", "venue", "city", "country"],
    frequency: "daily",
    retention: "until superseded",
    attribution: "Event data via ONE Championship (onefc.com).",
    enabled: true,
    note: "ENABLED via operator override (dev). Requires ENABLE_SCRAPER=true. Fight cards/results not " +
      "scraped (not in static HTML). Not a licence — see basis.",
  },
  {
    id: "one-fighters",
    name: "ONE Championship athletes (onefc.com)",
    host: "onefc.com",
    method: "scrape",
    basis: "NONE. Athlete profiles are not scraped yet (events-only provider). Enable with a basis " +
      "if/when athlete ingestion is built.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED. ONE provider currently ingests events only.",
  },
  {
    // The ADCC (BJJ / submission grappling) provider (src/lib/scraper/adcc).
    // Events only, from the static WordPress listing at adcombat.com/adcc-events/.
    // Enabled per explicit operator authorization (2026-07-16 session) to source
    // BJJ events; see basis.
    id: "adcc-events",
    name: "ADCC events (adcombat.com) — BJJ / submission grappling",
    host: "adcombat.com",
    method: "scrape",
    basis: "OPERATOR OVERRIDE (development), not an established legal basis. Enabled at the operator's " +
      "explicit instruction to ingest factual BJJ event data (name/date/location) for the schedule. " +
      "robots.txt allows the events listing (Disallow only /order/, /checkout, /scoreboard). A written " +
      "ADCC permission is still recommended for production/public use.",
    permittedFields: ["name", "date", "venue", "city", "posterUrl"],
    frequency: "daily",
    retention: "until superseded",
    attribution: "Event data via ADCC (adcombat.com).",
    enabled: true,
    note: "ENABLED via operator override (dev). Requires ENABLE_SCRAPER=true. Not a licence — see basis.",
  },
  {
    id: "federations",
    name: "Federation member directories (IJF, IMMAF, IFMA, WAKO, FIAS, WT)",
    host: "various governing bodies",
    method: "scrape",
    basis: "Unestablished. Public member lists are factual, which is a weaker claim against us, " +
      "but we have no permission and did not check robots.txt.",
    permittedFields: [],
    frequency: "never",
    retention: "n/a",
    attribution: null,
    enabled: false,
    note: "DISABLED pending a robots.txt-respecting client and, ideally, permission. The script " +
      "also self-enabled the scraper gate (`ENABLE_SCRAPER ??= \"true\"`), which is removed.",
  },
];

export const enabledSources = (): IngestionSource[] => INGESTION_SOURCES.filter((s) => s.enabled);

export function isSourceEnabled(id: string): boolean {
  return INGESTION_SOURCES.find((s) => s.id === id)?.enabled === true;
}

/**
 * Gate an ingestion run. Throws when the source is not registered or not enabled —
 * there is no "just this once".
 */
export function assertSourceEnabled(id: string): void {
  const source = INGESTION_SOURCES.find((s) => s.id === id);
  if (!source) {
    throw new Error(`Ingestion source "${id}" is not in the registry. Add it, with a legal basis, before running it.`);
  }
  if (!source.enabled) {
    throw new Error(`Ingestion source "${id}" is DISABLED: ${source.note ?? "no established legal basis"}`);
  }
}
