// ════════════════════════════════════════════════════════════════════════════
//  THE SOURCE LADDER, per sport. Evidence, not intentions.
//
//  Every entry records what a source ACTUALLY publishes, on the date it was
//  checked, so the next person does not repeat the search — and so a decision
//  not to build something is reviewable rather than mysterious.
//
//  This file writes nothing and is imported by the provider dashboard. It is
//  documentation with a type, which is the only kind that stays current.
//
//  ── THE RULE IT ENCODES ───────────────────────────────────────────────────
//
//  A provider is built when a source publishes structured, discoverable event
//  data. It is NOT built when the only way in is a brittle scrape of a
//  client-rendered marketing site — that costs requests, breaks silently, and
//  the audit then reports a coverage gap whose cause is a dead selector rather
//  than a missing source. "Unsupported, and here is the evidence" is a finished
//  piece of work.
// ════════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";

export type LadderStatus =
  /** A provider exists and runs against this source. */
  | "live"
  /** Structured data confirmed; a provider can be written. */
  | "supported"
  /** Reachable, but publishes materially less than we already hold. */
  | "thin"
  /** Checked and there is nothing parseable. Do not retry without new evidence. */
  | "no-source"
  /** Blocked by the host, or its terms forbid ingestion. */
  | "blocked"
  /** Not yet checked. */
  | "unprobed";

export interface LadderEntry {
  org: string;
  sport: Sport;
  status: LadderStatus;
  /** ISO date the evidence below was gathered. */
  checked: string | null;
  /** What was found, in enough detail to act on without re-checking. */
  evidence: string;
  /** One line, for a `blocked` entry: WHY, so the dashboard can state it. */
  blockedReason?: string;
  /** What to use instead. A block with no alternative is an open question. */
  recommendedReplacement?: string;
}

export const COVERAGE_LADDER: LadderEntry[] = [
  // ── BOXING ───────────────────────────────────────────────────────────────
  {
    org: "Wikipedia — Category:{year} boxing matches",
    sport: "BOXING",
    status: "live",
    checked: "2026-08-02",
    evidence:
      "The boxing provider. 13 categories (2015-2027), 238 articles discovered, 134 events and " +
      "1,147 bouts written. Took boxing from 20 events / 77 bouts to 149 / 1,157.",
  },
  {
    org: "Matchroom Boxing",
    sport: "BOXING",
    status: "thin",
    checked: "2026-08-02",
    evidence:
      "381-URL events sitemap (excellent discovery), crawlable. But NO JSON-LD and the event page " +
      "carries only the headline bout plus a one-line result — no undercard, no venue, no broadcaster. " +
      "Wikipedia already gives the full card for the same fights, so this adds requests and no bouts.",
  },
  {
    org: "Top Rank / PBC / Golden Boy / Queensberry",
    sport: "BOXING",
    status: "unprobed",
    checked: "2026-08-02",
    evidence:
      "Top Rank and Golden Boy are fully crawlable ('Disallow:' empty); Top Rank declares a sitemap, " +
      "Golden Boy does not. PBC is Drupal with Crawl-delay: 10 and a google-sitemap index — that delay " +
      "is a published rate limit and suits a slow background sweep, not a cron tick. Queensberry unchecked.",
  },

  // ── MUAY THAI ────────────────────────────────────────────────────────────
  {
    org: "ONE Championship (ONE Friday Fights / ONE Lumpinee)",
    sport: "MUAY_THAI",
    status: "live",
    checked: "2026-08-02",
    evidence:
      "The project's LARGEST Muay Thai corpus, and it was already ingested — filed as MMA, because the " +
      "year-page config pinned one sport per promotion and ONE runs four rulesets. ONE states each bout's " +
      "ruleset inside the weight class, so the card's sport is now derived from its bouts " +
      "(lib/scraper/ruleset). 95 Muay Thai events. No new provider was needed.",
  },
  {
    org: "Wikipedia — Category:{year} in Muay Thai",
    sport: "MUAY_THAI",
    status: "no-source",
    checked: "2026-08-02",
    evidence:
      "The category EXISTS but holds only amateur multi-sport competitions: 'Muaythai at the 2025 SEA " +
      "Games', '... 2025 World Games', '... 2025 Islamic Solidarity Games'. No professional cards. " +
      "'Category:Muay Thai events' does not exist. The boxing category shape does not transfer.",
  },
  {
    org: "Rajadamnern World Series (RWS)",
    sport: "MUAY_THAI",
    status: "no-source",
    checked: "2026-08-02",
    evidence:
      "No Wikipedia article of its own — a search returns only fighter biographies mentioning RWS bouts. " +
      "rwsmuaythai.com fails TLS: the certificate presented is for 0oo1.cz and does not cover the " +
      "hostname, so the site is not served there. Nothing to parse by either route.",
  },
  {
    org: "Thai Fight",
    sport: "MUAY_THAI",
    status: "thin",
    checked: "2026-08-02",
    evidence:
      "The 'Thai Fight' article carries a 106-row index (# | Event | Date | Venue | City, 2010-08-29 to " +
      "2025-06-08) — but event names DO NOT link to per-card articles, only venues and cities do. " +
      "Ingesting it would add 106 EMPTY cards, the exact failure the promotion-index `disabled` flag " +
      "exists for. Needs a results source, not a config entry.",
  },
  {
    org: "Max Muay Thai / Lumpinee / Bangla / Super Champ",
    sport: "MUAY_THAI",
    status: "no-source",
    checked: "2026-08-02",
    evidence:
      "'Max Muay Thai' is prose (History, Notable competitors, References) with no event table. " +
      "Lumpinee Boxing Stadium, Bangla Boxing Stadium and Super Champ Muay Thai are venue/programme " +
      "articles carrying no event index.",
  },
  {
    org: "WBC Muay Thai / IFMA / WMC / WMO",
    sport: "MUAY_THAI",
    status: "unprobed",
    checked: null,
    evidence:
      "Sanctioning bodies rather than promoters — they publish titles and rankings, not cards. Likely " +
      "valuable for TITLES and rankings rather than event ingestion. Not probed.",
  },

  // ── BJJ / GRAPPLING ──────────────────────────────────────────────────────
  {
    org: "ADCC (adcombat.com)",
    sport: "BJJ",
    status: "blocked",
    checked: "2026-08-02",
    evidence:
      "DIAGNOSED 2026-08-02. The provider is not missing and its code is not broken — the host " +
      "refuses us. Precisely: /robots.txt returns 200 and permits ALL crawling ('User-agent: *', " +
      "'Disallow:' empty) and advertises /sitemap_index.xml — but the homepage AND that very sitemap " +
      "both return HTTP 403. So the site's published policy allows us while an edge layer (WAF / bot " +
      "manager) blocks every non-browser client. It is not a robots decision, not a rate limit (a " +
      "single cold request is refused), not an endpoint change and not a code regression.\n\n" +
      "NOT WORKED AROUND, deliberately. lib/scraper/http is an explicitly honest client — one " +
      "identifying UA, no rotation, no browser spoofing, no challenge solving — and its stated " +
      "contract is that a 403 is FINAL. Spoofing a browser to get past a WAF would defeat a control " +
      "the operator chose to apply, whatever robots.txt says.",
    blockedReason:
      "Edge WAF returns 403 to all non-browser clients, including the sitemap its own robots.txt " +
      "advertises. Respecting it; not evading it.",
    recommendedReplacement:
      "Wikipedia ADCC World Championship editions, ALREADY CONFIGURED in tournament/config.ts " +
      "(key 'bjj', hubs '{year} ADCC World Championship'). Verified working — but medals-only and " +
      "biennial, so it yields ~1 event per championship. Real BJJ volume needs IBJJF / WNO / Polaris.",
  },
  {
    org: "Wikipedia — ADCC World Championship editions",
    sport: "BJJ",
    status: "supported",
    checked: "2026-08-02",
    evidence:
      "Per-edition articles exist ('2022 ADCC World Championship', '2024 ADCC World Championship') " +
      "alongside the parent 'ADCC Submission Fighting World Championship'. This is the bracket/medal " +
      "shape the tournament provider already reads. The most credible replacement for the 403'd " +
      "adcombat scrape, and the next BJJ work.",
  },
  {
    org: "IBJJF",
    sport: "BJJ",
    status: "unprobed",
    checked: "2026-08-02",
    evidence:
      "Crawlable (Allow: /, disallows only /admin and /wp-content) with a declared sitemap — but the " +
      "sitemap holds ~20 static pages and the events destination is a single /events/results URL, " +
      "which suggests a client-rendered results app rather than indexable pages. Needs one probe of " +
      "that page before deciding.",
  },
  {
    org: "Wikipedia — Category:{year} in Brazilian jiu-jitsu",
    sport: "BJJ",
    status: "no-source",
    checked: "2026-08-02",
    evidence: "Category does not exist. The boxing category shape does not transfer to BJJ either.",
  },
  {
    org: "WNO / Polaris / Fight2Win / AJP / EBI / Quintet / B-Team / CJI",
    sport: "BJJ",
    status: "unprobed",
    checked: null,
    evidence:
      "Not probed. WNO sits behind FloGrappling (subscription), which makes its terms the first thing " +
      "to check rather than its markup.",
  },
];

export const ladderFor = (sport: Sport): LadderEntry[] =>
  COVERAGE_LADDER.filter((e) => e.sport === sport);

/** Counts by status, for the provider dashboard's header. */
export function ladderSummary(): Record<LadderStatus, number> {
  const out = { live: 0, supported: 0, thin: 0, "no-source": 0, blocked: 0, unprobed: 0 };
  for (const e of COVERAGE_LADDER) out[e.status] += 1;
  return out;
}
