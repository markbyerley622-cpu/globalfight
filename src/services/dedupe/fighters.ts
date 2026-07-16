// Fighter identity resolution. Given a normalized fighter from some provider,
// find the canonical Fighter row it refers to — or report that it's new.
//
// Match precedence (highest confidence first):
//   1. external id   — exact (source, externalId) we've already linked
//   2. alias         — exact normalized alias hit
//   3. name + sport  — nameKey equality, then looseKey (first+last) equality
//
// Pure DB reads; never writes. The caller decides whether to insert/link.

import { prisma } from "@/lib/db";
import type { Sport } from "@/lib/types";
import { nameKey, looseKey, normalizeName } from "../normalization/names";

export type MatchType = "external_id" | "alias" | "name_exact" | "name_loose" | "none";

export interface FighterMatch {
  fighterId: string | null;
  matchType: MatchType;
  confidence: number; // 0..1
}

export interface ResolveFighterInput {
  source: string;
  externalId?: string;
  name: string;
  sport: Sport;
}

export async function resolveFighter(input: ResolveFighterInput): Promise<FighterMatch> {
  // 1) Known external id. (Provenance tables are additive — tolerate their
  //    absence on a DB that hasn't run `db:push` and fall through to name match.)
  if (input.externalId) {
    const link = await prisma.fighterExternalId
      .findUnique({
        where: { source_externalId: { source: input.source, externalId: input.externalId } },
        select: { fighterId: true },
      })
      .catch(() => null);
    if (link) return { fighterId: link.fighterId, matchType: "external_id", confidence: 1 };
  }

  // 2) Known alias.
  const loose = looseKey(input.name);
  const aliasHit = await prisma.fighterAlias
    .findFirst({ where: { normalized: loose }, select: { fighterId: true } })
    .catch(() => null);
  if (aliasHit) return { fighterId: aliasHit.fighterId, matchType: "alias", confidence: 0.95 };

  // 3) Name + sport. Narrow candidates by last-name token, compare in app.
  const tokens = nameKey(input.name).split(" ").filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (!last) return { fighterId: null, matchType: "none", confidence: 0 };

  const candidates = await prisma.fighter.findMany({
    where: { sport: input.sport, name: { contains: last, mode: "insensitive" } },
    select: { id: true, name: true },
    take: 50,
  });

  const wantKey = nameKey(input.name);
  const wantLoose = loose;
  let looseMatch: string | null = null;

  for (const c of candidates) {
    const cKey = nameKey(c.name);
    if (cKey === wantKey || normalizeName(c.name) === normalizeName(input.name)) {
      return { fighterId: c.id, matchType: "name_exact", confidence: 0.9 };
    }
    if (!looseMatch && looseKey(c.name) === wantLoose) looseMatch = c.id;
  }
  if (looseMatch) return { fighterId: looseMatch, matchType: "name_loose", confidence: 0.7 };

  return { fighterId: null, matchType: "none", confidence: 0 };
}
