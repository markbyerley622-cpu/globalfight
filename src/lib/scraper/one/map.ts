// ════════════════════════════════════════════════════════════════════════
//  ONE Championship — canonical mapping (pure). OneEvent → NormalizedEvent.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent } from "@/services/providers/types";
import type { Sport } from "@/lib/types";
import type { OneEvent } from "./types";

export const ONE_SOURCE = "one";
export const ONE_CONFIDENCE = 0.9;

export function toNormalizedOneEvent(e: OneEvent, lastUpdated: string): NormalizedEvent & { posterUrl?: string } {
  const isCode = !!e.country && /^[A-Za-z]{2}$/.test(e.country);
  return {
    externalId: e.slug,
    name: e.name,
    sport: e.sport as Sport,
    promotion: "ONE Championship",
    venue: e.venue ?? undefined,
    city: e.city ?? undefined,
    country: isCode ? undefined : e.country ?? undefined,
    countryCode: isCode ? e.country!.toUpperCase() : undefined,
    date: e.date ?? new Date(0).toISOString(),
    status: e.status,
    posterUrl: e.posterUrl ?? undefined,
    fights: [], // ONE cards are not in static HTML; schedule needs name/date/venue only
    _meta: { source: ONE_SOURCE, confidence: ONE_CONFIDENCE, lastUpdated, externalId: e.slug },
  };
}
