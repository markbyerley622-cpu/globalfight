// Data-source priority engine. Per sport, an ordered list of source keys —
// highest trust first. The aggregator queries in this order and the confidence
// weights resolve conflicts (a higher-confidence field never gets overwritten).
//
// Sources include non-API ones ("espn", "scraper") so the same ranking drives
// both API selection and scraper fallback ordering.

import type { Sport } from "@/lib/types";

export interface SourceRank {
  key: string;
  confidence: number; // 0..1 base trust weight
}

// Ordering mirrors the product spec. Confidence is the base weight; providers
// may refine per-record confidence in their _meta.
const PRIORITY: Record<Sport, SourceRank[]> = {
  MMA: [
    { key: "sportradar", confidence: 0.98 },
    { key: "fightanalytics", confidence: 0.9 },
    { key: "api-sports", confidence: 0.82 },
    { key: "scraper", confidence: 0.5 },
  ],
  BOXING: [
    { key: "boxing-data", confidence: 0.95 },
    { key: "sportbex", confidence: 0.88 },
    { key: "sportradar", confidence: 0.9 },
    { key: "scraper", confidence: 0.6 },
  ],
  KICKBOXING: [
    { key: "fightanalytics", confidence: 0.9 },
    { key: "sportbex", confidence: 0.85 },
    { key: "scraper", confidence: 0.55 },
  ],
  MUAY_THAI: [
    { key: "fightanalytics", confidence: 0.9 },
    { key: "sportbex", confidence: 0.85 },
    { key: "scraper", confidence: 0.55 },
  ],
  K1: [
    { key: "fightanalytics", confidence: 0.9 },
    { key: "scraper", confidence: 0.55 },
  ],
  BARE_KNUCKLE: [
    { key: "sportradar", confidence: 0.8 },
    { key: "scraper", confidence: 0.6 },
  ],
  BJJ: [
    { key: "fightanalytics", confidence: 0.8 },
    { key: "scraper", confidence: 0.55 },
  ],
  BJJ_NOGI: [
    { key: "fightanalytics", confidence: 0.8 },
    { key: "scraper", confidence: 0.55 },
  ],
  WRESTLING: [
    { key: "fightanalytics", confidence: 0.8 },
    { key: "scraper", confidence: 0.5 },
  ],
  JUDO: [{ key: "scraper", confidence: 0.5 }],
  TAEKWONDO: [{ key: "scraper", confidence: 0.5 }],
  SAMBO: [{ key: "scraper", confidence: 0.5 }],
  COMBAT_SAMBO: [{ key: "scraper", confidence: 0.5 }],
};

export function sourcePriority(sport: Sport): SourceRank[] {
  return PRIORITY[sport] ?? [{ key: "scraper", confidence: 0.5 }];
}

/** Base confidence for a source within a sport (0 if not ranked). */
export function sourceConfidence(sport: Sport, key: string): number {
  return sourcePriority(sport).find((s) => s.key === key)?.confidence ?? 0;
}

/** Ordered API source keys for a sport (excludes the non-API scraper). */
export function apiSourceOrder(sport: Sport): string[] {
  return sourcePriority(sport)
    .map((s) => s.key)
    .filter((k) => k !== "scraper");
}
