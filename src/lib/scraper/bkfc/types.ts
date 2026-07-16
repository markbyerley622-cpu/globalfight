// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — shared types.
//
//  The Bkfc* types below are the RAW extraction shapes emitted by the parsers
//  (plain string-unions, unit-testable without a DB). `map.ts` converts them
//  into the repository's canonical Normalized* DTOs (src/services/providers/
//  types.ts). `syncBKFC()` returns those canonical entities as a BkfcHarvest;
//  the provider never persists — the shared ingestion pipeline
//  (services/sync/persist.ts) owns writes, dedupe and provenance.
// ════════════════════════════════════════════════════════════════════════

import type {
  NormalizedEvent,
  NormalizedFighter,
  NormalizedRanking,
  NormalizedArticle,
} from "@/services/providers/types";

/** Corner colour, as BKFC renders it (red = first-listed, blue = second). */
export type Corner = "red" | "blue";

/** Per-corner result token as it appears in the event card markup. */
export type CardResult = "win" | "lose" | "draw" | "no contest";

/** Which entity kinds the provider knows how to sync. */
export type BkfcEntity = "events" | "fighters" | "rankings" | "news" | "videos";

/** Sync cadence — governs how much of the archive a run walks. */
export type SyncMode =
  | "full" // whole archive from the sitemap
  | "daily" // recent + anything whose Last-Modified changed
  | "hourly" // upcoming/live events + very recent news only
  | "event" // one event, by slug
  | "fighter"; // one fighter, by slug

/** A win/loss/draw record. */
export interface BkfcRecord {
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
}

/** One bout on an event card. */
export interface BkfcBout {
  orderOnCard: number;
  redName: string;
  blueName: string;
  redSlug: string | null;
  blueSlug: string | null;
  weightClass: string | null;
  titleFight: boolean;
  mainEvent: boolean;
  coMain: boolean;
  scheduledRounds: number | null;
  /** Per-corner result, when the event is complete. */
  redResult: CardResult | null;
  blueResult: CardResult | null;
  /** Derived winner corner, or null when scheduled / draw / NC. */
  winnerCorner: Corner | null;
  /** Best-effort finish details — null when the page does not expose them. */
  method: string | null;
  roundEnded: number | null;
  timeEnded: string | null;
}

/** A BKFC event with its card. */
export interface BkfcEvent {
  slug: string;
  url: string;
  name: string;
  /** Parsed "BKFC 10" → 10, when the name carries a number. */
  number: number | null;
  posterUrl: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  /** ISO date string, or null when unparseable. */
  date: string | null;
  status: "ANNOUNCED" | "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED" | "POSTPONED";
  ticketsUrl: string | null;
  watchUrl: string | null;
  bouts: BkfcBout[];
}

/** A social profile link scraped from a fighter page. */
export interface BkfcSocial {
  platform: "instagram" | "twitter" | "facebook" | "youtube" | "tiktok" | "web";
  url: string;
}

/** A BKFC fighter profile. */
export interface BkfcFighter {
  slug: string;
  url: string;
  name: string;
  nickname: string | null;
  imageUrl: string | null;
  record: BkfcRecord | null;
  division: string | null;
  heightCm: number | null;
  reachCm: number | null;
  stance: "ORTHODOX" | "SOUTHPAW" | "SWITCH" | null;
  nationality: string | null;
  socials: BkfcSocial[];
}

/** One row of a divisional ranking. `rank` 0 marks the champion. */
export interface BkfcRankingRow {
  division: string;
  rank: number;
  isChampion: boolean;
  fighterName: string;
  fighterSlug: string | null;
}

/** A BKFC news article. */
export interface BkfcArticle {
  slug: string;
  url: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  category: string | null;
  author: string | null;
  coverImageUrl: string | null;
  /** ISO date string, or null. */
  publishedAt: string | null;
}

/** A video embed found on the site. */
export interface BkfcVideo {
  title: string;
  url: string;
  youtubeId: string | null;
  thumbnail: string | null;
  description: string | null;
  publishedAt: string | null;
}

/** URLs discovered from the sitemap, bucketed by kind. */
export interface DiscoveredUrls {
  events: string[];
  fighters: string[];
  news: string[];
  other: string[];
}

/** Acquisition/transformation counters for one harvest (NOT persistence metrics). */
export interface HarvestReport {
  mode: SyncMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Pages the sitemap offered, per entity. */
  discovered: Record<BkfcEntity, number>;
  /** Canonical records produced, per entity. */
  extracted: Record<BkfcEntity, number>;
  /** Records dropped by validation, per entity. */
  rejected: Record<BkfcEntity, number>;
  warnings: string[];
}

/**
 * What `syncBKFC()` returns: canonical entities ready for the shared ingestion
 * pipeline. The provider does not persist — the runner hands `events`/`fighters`
 * to persistAggregated(); the rest are returned for whatever the framework wires
 * next (rankings/news are policy-gated; videos have no aggregated persister yet).
 */
export interface BkfcHarvest {
  report: HarvestReport;
  events: NormalizedEvent[];
  fighters: NormalizedFighter[];
  rankings: NormalizedRanking[];
  news: NormalizedArticle[];
  videos: BkfcVideo[];
}

/** Options accepted by `syncBKFC()`. */
export interface SyncOptions {
  mode?: SyncMode;
  /** Restrict to a subset of entities (default: all). */
  entities?: BkfcEntity[];
  /** For mode "event" / "fighter": the target slug. */
  slug?: string;
  /** Hard cap on pages fetched (safety valve for `full`). 0 = unlimited. */
  maxPages?: number;
}
