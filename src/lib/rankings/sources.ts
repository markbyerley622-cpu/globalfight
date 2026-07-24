import type { TrustLevel } from "./connector";

// ════════════════════════════════════════════════════════════════════════
//  Ranking source registry — the catalogue of ranking sources, tiered by trust,
//  with an explicit per-source `licensed` flag. The engine only ingests a source
//  when `licensed: true` — every source starts OFF, so nothing is scraped until
//  the owner clears it. This is where new connectors get registered; the parser
//  itself lives in a connector module implementing RankingConnector.
//
//  Tiering follows the owner's guidance:
//    Tier 1 (official)  — sanctioning bodies + national federations' own lists.
//    Tier 2 (secondary) — regional/records aggregators used as interim sources.
//    Tier 3 (media)     — reputable media rankings; supplemental only.
//    Excluded           — sources whose terms forbid ingestion (e.g. BoxRec):
//                         reference/identity-matching only where permitted,
//                         NEVER bulk-ingested.
// ════════════════════════════════════════════════════════════════════════

export interface RankingSource {
  id: string;
  label: string;
  organisation: string;
  url: string;
  tier: 1 | 2 | 3;
  trust: TrustLevel;
  /** boxing scope hint; the engine is multi-sport but this list is boxing-first. */
  scope: string;
  /** MUST be true before the engine will ingest it. Owner-controlled. */
  licensed: boolean;
  /** Ingestion is not yet built for it (parser pending). */
  connectorReady: boolean;
  notes?: string;
}

export const RANKING_SOURCES: RankingSource[] = [
  // ── Tier 1 — official sanctioning bodies ──────────────────────────────
  { id: "wba-female", label: "WBA Female", organisation: "WBA", url: "https://www.wbaboxing.com/wba-female-ranking", tier: 1, trust: "official", scope: "boxing/female/world", licensed: false, connectorReady: true, notes: "Reference connector — server-rendered HTML tables, verified end-to-end (193 entries/16 divisions). Set licensed:true + RANKINGS_INGEST_ENABLED=true to go live." },
  { id: "wbc-female", label: "WBC Female", organisation: "WBC", url: "https://wbcboxing.com/en/main-ratings/", tier: 1, trust: "official", scope: "boxing/female/world", licensed: false, connectorReady: false },
  { id: "wbo-female", label: "WBO Female", organisation: "WBO", url: "https://wboboxing.com/wborankings/", tier: 1, trust: "official", scope: "boxing/female/world", licensed: false, connectorReady: false },
  { id: "ibf-female", label: "IBF/USBA Female", organisation: "IBF", url: "https://www.ibf-usba-boxing.com/ratings/", tier: 1, trust: "official", scope: "boxing/female/world", licensed: false, connectorReady: false },
  { id: "ebu-male", label: "EBU European (Male)", organisation: "EBU", url: "https://www.boxebu.com/", tier: 1, trust: "official", scope: "boxing/male/europe", licensed: false, connectorReady: false, notes: "Published as monthly PDF — needs a PDF connector." },
  { id: "ebu-female", label: "EBU European (Female)", organisation: "EBU", url: "https://www.boxebu.com/", tier: 1, trust: "official", scope: "boxing/female/europe", licensed: false, connectorReady: false, notes: "Monthly PDF." },
  { id: "boxing-ireland", label: "Boxing Ireland", organisation: "Boxing Ireland", url: "https://boxingireland.ie/", tier: 1, trust: "federation", scope: "boxing/ireland", licensed: false, connectorReady: false },
  { id: "ipba", label: "Indian Professional Boxing (IPBA)", organisation: "IPBA", url: "https://www.ipbaboxing.com/", tier: 1, trust: "federation", scope: "boxing/india", licensed: false, connectorReady: false },

  // ── Tier 2 — strong secondary / regional aggregators ──────────────────
  { id: "british-boxers", label: "British Boxers Rankings", organisation: "British Boxing", url: "https://britishboxers.uk/rankings", tier: 2, trust: "media", scope: "boxing/uk", licensed: false, connectorReady: false, notes: "Client-rendered — rankings load via JS with no server HTML or data endpoint. Needs a headless fetch, not a plain connector. WBA (Tier 1) used as the reference source instead." },
  { id: "fightersrec-pk", label: "FightersRec — Pakistan", organisation: "FightersRec", url: "https://fightersrec.com/RankingCountries/PAKISTAN/Male/PROFESSIONAL/BOXING", tier: 2, trust: "community", scope: "boxing/pakistan", licensed: false, connectorReady: false },

  // ── Tier 3 — media / supplemental ─────────────────────────────────────
  { id: "boxingscene", label: "BoxingScene World Rankings", organisation: "BoxingScene", url: "https://www.boxingscene.com/rankings", tier: 3, trust: "media", scope: "boxing/world", licensed: false, connectorReady: false },
  { id: "commonwealth-bn", label: "Commonwealth (Boxing News)", organisation: "Boxing News", url: "https://pocketmags.com/au/boxing-news-uk-magazine", tier: 3, trust: "media", scope: "boxing/commonwealth", licensed: false, connectorReady: false, notes: "Behind a magazine paywall — not machine-ingestible; manual entry only." },

  // ── Excluded from ingestion (reference only) ──────────────────────────
  { id: "boxrec", label: "BoxRec (reference only)", organisation: "BoxRec", url: "https://boxrec.com/en/ratings/F", tier: 3, trust: "community", scope: "boxing/world", licensed: false, connectorReady: false, notes: "TERMS FORBID BULK INGEST. Reference + identity-matching only where permitted; never ingested into the ranking tables." },
];

/** Sources the engine is currently allowed to ingest (licensed AND a parser exists). */
export function ingestibleSources(): RankingSource[] {
  return RANKING_SOURCES.filter((s) => s.licensed && s.connectorReady);
}

/** Count by tier — for the admin dashboard + docs. */
export function sourceTierCounts(): Record<1 | 2 | 3, number> {
  return RANKING_SOURCES.reduce(
    (acc, s) => ((acc[s.tier] += 1), acc),
    { 1: 0, 2: 0, 3: 0 } as Record<1 | 2 | 3, number>,
  );
}
