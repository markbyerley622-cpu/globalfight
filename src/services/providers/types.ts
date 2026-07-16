// ════════════════════════════════════════════════════════════════════════
//  Provider contract — every external data source implements CombatDataProvider.
//
//  Providers return *normalized* DTOs (provider-shape → our shape) tagged with
//  SourceMeta so the aggregator can resolve identity, rank by confidence and
//  merge without ever overwriting higher-confidence data with lower.
// ════════════════════════════════════════════════════════════════════════

import type { Sport, Stance, EventStatus, FightResult, FightMethod } from "@/lib/types";

export type Entity = "events" | "fighters" | "rankings" | "results" | "news";

/** Provenance attached to every normalized record. */
export interface SourceMeta {
  source: string; // DataSource.key, e.g. "sportradar"
  confidence: number; // 0..1
  lastUpdated: string; // ISO timestamp the source last refreshed this record
  externalId: string; // stable id within the source
}

export interface NormalizedFighter {
  externalId: string;
  name: string;
  aliases?: string[];
  nickname?: string;
  sport: Sport;
  nationality?: string;
  countryCode?: string;
  birthDate?: string;
  heightCm?: number;
  reachCm?: number;
  stance?: Stance;
  wins?: number;
  losses?: number;
  draws?: number;
  noContests?: number;
  koWins?: number;
  imageUrl?: string;
  active?: boolean;
  _meta: SourceMeta;
}

export interface NormalizedFightStub {
  redName: string;
  blueName: string;
  redExternalId?: string;
  blueExternalId?: string;
  weightClass?: string;
  scheduledRounds?: number;
  titleFight?: boolean;
  mainEvent?: boolean;
  result?: FightResult;
  method?: FightMethod;
  roundEnded?: number;
  /** External id (within the same source) of the winning fighter, when decided. */
  winnerExternalId?: string;
}

export interface NormalizedEvent {
  externalId: string;
  name: string;
  sport: Sport;
  promotion?: string;
  venue?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  broadcaster?: string;
  date: string; // ISO
  status?: EventStatus;
  fights?: NormalizedFightStub[];
  _meta: SourceMeta;
}

export interface NormalizedRankingEntry {
  weightClass: string;
  isPoundForPound?: boolean;
  rank: number;
  fighterName: string;
  fighterExternalId?: string;
}

export interface NormalizedRanking {
  sport: Sport;
  entries: NormalizedRankingEntry[];
  _meta: SourceMeta;
}

export interface NormalizedArticle {
  externalId: string;
  title: string;
  excerpt?: string;
  url: string;
  imageUrl?: string;
  publishedAt: string;
  _meta: SourceMeta;
}

/** Uniform envelope returned by every provider call — never throws. */
export interface ProviderResult<T> {
  configured: boolean; // false when the API key/credentials are absent
  ok: boolean; // request succeeded (true even when configured:false → empty)
  latencyMs: number;
  rateLimited: boolean;
  error?: string;
  data: T[];
}

export interface FetchOpts {
  sport?: Sport;
  since?: string; // ISO — incremental sync window
  limit?: number;
}

export interface CombatDataProvider {
  /** Stable DataSource.key. */
  readonly key: string;
  readonly label: string;
  /** Sports this provider can serve; the aggregator filters on this. */
  readonly sports: readonly Sport[];
  /** True when required env credentials are present. */
  isConfigured(): boolean;

  getEvents(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>>;
  getFighters(opts?: FetchOpts): Promise<ProviderResult<NormalizedFighter>>;
  getRankings(opts?: FetchOpts): Promise<ProviderResult<NormalizedRanking>>;
  getResults(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>>;
  getNews(opts?: FetchOpts): Promise<ProviderResult<NormalizedArticle>>;
}
