// ════════════════════════════════════════════════════════════════════════
//  ADCC — canonical mapping (pure). AdccEvent → NormalizedEvent (sport BJJ).
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent } from "@/services/providers/types";
import type { Sport } from "@/lib/types";
import type { AdccEvent } from "./types";

export const ADCC_SOURCE = "adcc";
export const ADCC_CONFIDENCE = 0.85;
export const ADCC_SPORT: Sport = "BJJ";

export function toNormalizedAdccEvent(e: AdccEvent, lastUpdated: string): NormalizedEvent & { posterUrl?: string } {
  return {
    externalId: e.slug,
    name: e.name,
    sport: ADCC_SPORT,
    promotion: "ADCC",
    venue: e.venue ?? undefined,
    city: e.city ?? undefined,
    country: e.country ?? undefined,
    date: e.date ?? new Date(0).toISOString(),
    status: e.status,
    posterUrl: e.posterUrl ?? undefined,
    fights: [],
    _meta: { source: ADCC_SOURCE, confidence: ADCC_CONFIDENCE, lastUpdated, externalId: e.slug },
  };
}
