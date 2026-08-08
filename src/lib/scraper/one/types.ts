// ════════════════════════════════════════════════════════════════════════
//  ONE Championship provider — shared types.
//
//  onefc.com is WordPress (REST API auth-locked), so this is HTML + JSON-LD
//  scraping. ONE cards are mixed-ruleset; we drive the schedule from the
//  schema.org/Event JSON-LD (clean date/venue/location) and assign a per-event
//  sport heuristically (the "ONE Friday Fights" series is Muay Thai / kickboxing).
//  Like BKFC this is a PURE provider: syncONE() returns canonical Normalized*.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFighter } from "@/services/providers/types";

/** Sports ONE cards map to in this project. */
export type OneSport = "MUAY_THAI" | "KICKBOXING" | "MMA";

/**
 * One bout as ONE's event page states it — source-shaped, not yet canonical.
 *
 * Enum mapping (ruleset, method, result) belongs to ./map, the same split the
 * wikicard provider uses: the extractor reports what was written, the mapper
 * decides what it means.
 */
export interface OneMatchup {
  /** Position on the card. 0 is the main event — ONE emits it first. */
  order: number;
  redName: string;
  blueName: string;
  /** ONE's athlete slug — a stable per-corner external id. Null if unlinked. */
  redExternalId: string | null;
  blueExternalId: string | null;
  /** ONE's own bout label, e.g. "Featherweight Muay Thai World Championship". */
  label: string | null;
  /** `label` with ruleset and championship wording removed. */
  weightClass: string | null;
  titleFight: boolean;
  /** Winning corner, or null when the page states no outcome. */
  winner: "red" | "blue" | null;
  /** Published finish wording, e.g. "Split Decision (R3)". Null when unstated. */
  methodText: string | null;
  round: number | null;
  noContest: boolean;
}

/** Raw extraction shape for a ONE event page. */
export interface OneEvent {
  slug: string;
  url: string;
  name: string;
  /** ISO datetime (kept with time + timezone), or null. */
  date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  posterUrl: string | null;
  sport: OneSport;
  status: "SCHEDULED" | "COMPLETED";
  /** The card, main event first. Empty when ONE has not announced/archived one. */
  bouts: OneMatchup[];
}

export interface OneHarvestReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: { events: number };
  extracted: { events: number; fighters: number };
  rejected: { events: number };
  warnings: string[];
}

/** What syncONE() returns — canonical entities for the shared pipeline. */
export interface OneHarvest {
  report: OneHarvestReport;
  events: NormalizedEvent[];
  fighters: NormalizedFighter[];
}

export interface SyncOptions {
  /** Hard cap on event pages fetched. 0 = unlimited. */
  maxPages?: number;
  /** Single event by slug (skips discovery). */
  slug?: string;
  /**
   * Exact event URLs to fetch, skipping discovery.
   *
   * The runner uses this to fetch a WINDOW of the sitemap (see ./sweep): a full
   * sweep is ~35 minutes against a 5-minute cron ceiling, so the caller picks
   * which slice this tick pays for. syncONE stays pure — the resume cursor
   * belongs to the runner, which is the layer that has a database.
   */
  urls?: string[];
}
