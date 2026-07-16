// ════════════════════════════════════════════════════════════════════════
//  Ranking generation job (backend only — never the frontend).
//
//  For each sport: collect its fighters, score them with the rating engine,
//  drop the unrankable (too few bouts → UNRANKED), and write real Ranking
//  rows to Postgres. Curated rankings (e.g. from licensed API providers)
//  are never overwritten — generation only fills sports that have none.
//
//  Divisional rankings need a per-fighter weight/division, which most imported
//  fighters don't carry yet, so this job produces the pound-for-pound list per
//  sport (no division needed). Divisional generation activates automatically
//  once fighters carry division data.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { fighterRating, isRankable } from "@/lib/rankings/engine";
import { SPORT_LABEL } from "@/lib/sports";

const MAX_RANKED = 100;

export interface GenerateResult {
  sport: string;
  ranked: number;
  unranked: number;
  skipped?: string;
}

/** A P4P "division" anchor per sport (Ranking requires a weightClassId). */
async function ensureP4PWeightClass(sportValue: string): Promise<string> {
  const slug = `p4p-${sportValue.toLowerCase()}`;
  const wc = await prisma.weightClass.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: `${SPORT_LABEL[sportValue] ?? sportValue} Pound for Pound`,
      sport: sportValue as Parameters<typeof prisma.weightClass.create>[0]["data"]["sport"],
      order: 999,
    },
    select: { id: true },
  });
  return wc.id;
}

export async function generateP4P(sportValue: string): Promise<GenerateResult> {
  // Never clobber curated (scraped) rankings.
  const curated = await prisma.ranking.count({
    where: { isPoundForPound: true, source: { not: "generated" }, fighter: { sport: sportValue as never } },
  });
  if (curated > 0) return { sport: sportValue, ranked: 0, unranked: 0, skipped: "curated rankings present" };

  const fighters = await prisma.fighter.findMany({
    where: { sport: sportValue as never },
    select: { id: true, wins: true, losses: true, draws: true, noContests: true, koWins: true, totalRounds: true },
  });
  if (fighters.length === 0) return { sport: sportValue, ranked: 0, unranked: 0, skipped: "no fighters" };

  const eligible = fighters
    .filter(isRankable)
    .map((f) => ({ id: f.id, rating: fighterRating(f) }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, MAX_RANKED);
  const unranked = fighters.length - eligible.length;

  const weightClassId = await ensureP4PWeightClass(sportValue);

  // Atomically replace this sport's generated P4P.
  await prisma.$transaction([
    prisma.ranking.deleteMany({ where: { isPoundForPound: true, source: "generated", fighter: { sport: sportValue as never } } }),
    ...eligible.map((e, i) =>
      prisma.ranking.create({
        data: {
          weightClassId, fighterId: e.id, isPoundForPound: true,
          rank: i + 1, rating: e.rating, source: "generated", movement: "SAME",
        },
      }),
    ),
  ]);

  return { sport: sportValue, ranked: eligible.length, unranked };
}

export async function generateAllP4P(sportValues: string[]): Promise<GenerateResult[]> {
  const results: GenerateResult[] = [];
  for (const s of sportValues) results.push(await generateP4P(s));
  return results;
}
