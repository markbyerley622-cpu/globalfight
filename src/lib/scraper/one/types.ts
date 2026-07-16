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
}
