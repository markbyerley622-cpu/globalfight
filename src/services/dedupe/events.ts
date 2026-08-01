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
    if (cn === want) return { eventId: c.id, matchType: "name_date", confidence: 0.85 };
    if (containsSameCard(cn, want)) {
      return { eventId: c.id, matchType: "name_date", confidence: 0.85 };
    }
  }
  return { eventId: null, matchType: "none", confidence: 0 };
}

/**
 * Is one name the same card as the other, just written at more length?
 *
 * Containment is the right instinct — "UFC 300" and "UFC 300 Pereira vs Hill" are
 * one card — but bare containment merges cards that a NUMBER distinguishes:
 *
 *     "fists of fury"     ⊂ "fists of fury 2"      different cards, same night
 *     "ufc fight night 1" ⊂ "ufc fight night 10"   different cards entirely
 *
 * ONE ran Fists Of Fury 1, 2 AND 3 on 2021-02-26. Under bare containment all
 * three resolved to one row, so two cards' bouts were written onto the third —
 * 73 bouts across 12 events, silently, with every card still looking plausible.
 *
 * So containment holds only when what the longer name adds is DESCRIPTIVE. If the
 * extra text carries a digit, it is a card designation and the two are not the
 * same event.
 */
export function containsSameCard(a: string, b: string): boolean {
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (!long.includes(short)) return false;
  const extra = long.replace(short, "");
  return !/\d/.test(extra);
}
