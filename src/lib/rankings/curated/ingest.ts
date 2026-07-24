import "server-only";
import { prisma } from "@/lib/db";
import { SPORT_LABEL } from "@/lib/sports";
import { fighterSlug, movementFor } from "@/lib/rankings/ingest-rules";
import { CURATED_P4P, type CuratedList } from "./lists";

// ════════════════════════════════════════════════════════════════════════
//  Curated P4P ingest. Writes the source-backed lists (lists.ts) into the SAME
//  Ranking model the UI already renders, as isPoundForPound rows with
//  source="curated". The rating engine (generate.ts) already refuses to touch
//  any sport that has non-"generated" rankings, so curated is never clobbered.
//
//  Precedence: curated fills gaps; it never overwrites a higher-trust source
//  (official/connector) or a manual edit. Those don't exist for these sports
//  yet, but the guard is here so they win automatically when they arrive.
//  Movement + RankSnapshot give history; re-runs are idempotent.
// ════════════════════════════════════════════════════════════════════════

const CURATED = "curated";
/** Sources curated must not overwrite (higher trust or hand-edited). */
const PROTECTED = new Set(["manual", "official", "connector"]);

export interface CuratedIngestStat {
  sport: string;
  ranked: number;
  skipped?: string;
}

/** A P4P "division" anchor per sport (Ranking requires a weightClassId). */
async function ensureP4PWeightClass(sportValue: string): Promise<string> {
  const slug = `p4p-${sportValue.toLowerCase()}`;
  const wc = await prisma.weightClass.upsert({
    where: { slug },
    update: {},
    create: { slug, name: `${SPORT_LABEL[sportValue] ?? sportValue} Pound for Pound`, sport: sportValue as never, order: 999 },
    select: { id: true },
  });
  return wc.id;
}

async function resolveFighter(name: string, sport: string, countryCode: string | null): Promise<string> {
  const slug = fighterSlug(name);
  const existing = await prisma.fighter.findUnique({ where: { slug }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.fighter.create({
    data: { slug, name, sport: sport as never, countryCode: countryCode ?? undefined },
    select: { id: true },
  });
  return created.id;
}

async function ingestList(list: CuratedList): Promise<CuratedIngestStat> {
  // Refuse if a higher-trust source already owns this sport's P4P.
  const protectedRows = await prisma.ranking.count({
    where: { isPoundForPound: true, source: { in: [...PROTECTED] }, fighter: { sport: list.sport as never } },
  });
  if (protectedRows > 0) return { sport: list.sport, ranked: 0, skipped: "higher-trust source present" };

  const weightClassId = await ensureP4PWeightClass(list.sport);

  // Preserve prior curated ranks so movement is real across refreshes.
  const prior = await prisma.ranking.findMany({
    where: { isPoundForPound: true, source: CURATED, fighter: { sport: list.sport as never } },
    select: { fighterId: true, rank: true },
  });
  const priorRank = new Map(prior.map((r) => [r.fighterId, r.rank]));

  for (const entry of list.entries) {
    const fighterId = await resolveFighter(entry.name, list.sport, entry.countryCode);
    const previousRank = priorRank.get(fighterId) ?? null;
    const movement = movementFor(previousRank, entry.rank);
    await prisma.ranking.upsert({
      where: { weightClassId_isPoundForPound_fighterId: { weightClassId, isPoundForPound: true, fighterId } },
      create: { weightClassId, fighterId, isPoundForPound: true, rank: entry.rank, previousRank, movement, source: CURATED },
      update: { rank: entry.rank, previousRank, movement, source: CURATED },
    });
    await prisma.rankSnapshot.create({
      data: { fighterId, weightClass: `${list.sport} P4P`, isPoundForPound: true, rank: entry.rank },
    });
  }

  // Drop anyone who fell off this sport's curated list since last run.
  const keep = new Set(await Promise.all(list.entries.map((e) => resolveFighter(e.name, list.sport, e.countryCode))));
  await prisma.ranking.deleteMany({
    where: { isPoundForPound: true, source: CURATED, fighter: { sport: list.sport as never }, fighterId: { notIn: [...keep] } },
  });

  return { sport: list.sport, ranked: list.entries.length };
}

/** Ingest every curated list. Failures on one sport don't block the others. */
export async function ingestCuratedP4P(): Promise<CuratedIngestStat[]> {
  const stats: CuratedIngestStat[] = [];
  for (const list of CURATED_P4P) {
    try {
      stats.push(await ingestList(list));
    } catch (e) {
      stats.push({ sport: list.sport, ranked: 0, skipped: (e as Error).message });
    }
  }
  return stats;
}
