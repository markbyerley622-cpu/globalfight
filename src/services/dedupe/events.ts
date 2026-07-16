// Event identity resolution. The same card (e.g. "UFC 321") arrives from
// several providers with different ids and slightly different names/dates.
//
// Match precedence:
//   1. external id           — exact (source, externalId)
//   2. sport + date + name   — same sport, date within ±1 day, normalized-name
//                              equality or strong overlap

import { prisma } from "@/lib/db";
import type { Sport } from "@/lib/types";
import { normalizeName } from "../normalization/names";

export type EventMatchType = "external_id" | "name_date" | "none";

export interface EventMatch {
  eventId: string | null;
  matchType: EventMatchType;
  confidence: number;
}

export interface ResolveEventInput {
  source: string;
  externalId?: string;
  name: string;
  sport: Sport;
  date: string; // ISO
}

const DAY = 24 * 60 * 60 * 1000;

export async function resolveEvent(input: ResolveEventInput): Promise<EventMatch> {
  // Provenance tables are additive — tolerate their absence on a DB that hasn't
  // run `db:push` and fall through to name+date matching.
  if (input.externalId) {
    const link = await prisma.eventExternalId
      .findUnique({
        where: { source_externalId: { source: input.source, externalId: input.externalId } },
        select: { eventId: true },
      })
      .catch(() => null);
    if (link) return { eventId: link.eventId, matchType: "external_id", confidence: 1 };
  }

  const when = new Date(input.date);
  if (Number.isNaN(when.getTime())) return { eventId: null, matchType: "none", confidence: 0 };

  const candidates = await prisma.event.findMany({
    where: {
      sport: input.sport,
      date: { gte: new Date(when.getTime() - DAY), lte: new Date(when.getTime() + DAY) },
    },
    select: { id: true, name: true },
    take: 50,
  });

  const want = normalizeName(input.name);
  for (const c of candidates) {
    const cn = normalizeName(c.name);
    if (cn === want || cn.includes(want) || want.includes(cn)) {
      return { eventId: c.id, matchType: "name_date", confidence: 0.85 };
    }
  }
  return { eventId: null, matchType: "none", confidence: 0 };
}
