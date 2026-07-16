// ════════════════════════════════════════════════════════════════════════
//  ADCC (BJJ / submission grappling) provider — types.
//
//  adcombat.com is WordPress with a server-rendered events listing (the "RW
//  Events" plugin). A single page (/adcc-events/) carries every upcoming ADCC
//  event as static DOM, so this provider fetches one page — no sitemap crawl.
//  Sport = BJJ. Pure provider: syncADCC() returns canonical NormalizedEvent[].
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent } from "@/services/providers/types";

export interface AdccEvent {
  slug: string;
  url: string;
  name: string;
  date: string | null; // ISO
  venue: string | null;
  city: string | null;
  country: string | null;
  posterUrl: string | null;
  status: "SCHEDULED" | "COMPLETED";
}

export interface AdccHarvestReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: number;
  extracted: number;
  rejected: number;
  warnings: string[];
}

export interface AdccHarvest {
  report: AdccHarvestReport;
  events: NormalizedEvent[];
}

export interface SyncOptions {
  /** Cap events kept (0 = all). */
  maxEvents?: number;
}
