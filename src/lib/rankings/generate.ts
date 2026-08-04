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
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fighterRating, isRankable } from "@/lib/rankings/engine";
import { SPORT_LABEL } from "@/lib/sports";
import { rankableInDiscipline } from "@/lib/fighters/discipline-query";

const MAX_RANKED = 100;

/**
 * Single-promotion "entertainment boxing" that must never become the default
 * representation of a sport's general P4P — see `excludeSinglePromotionOnly`.
 * Keyed by Event.promotion, which is what the promotion-index scraper writes
 * (lib/scraper/promotion-index/config.ts).
 */
const SINGLE_PROMOTION_EXCLUSIONS: Record<string, string> = {
  BOXING: "Misfits Boxing",
};

/**
 * Fighters whose ENTIRE tracked bout history sits inside one promotion get
 * excluded from that sport's general P4P pool — they still have profiles,
 * still show up in the directory and on their own event/fight pages, and
 * still rank inside their promotion's own results; they just don't compete
 * for "Boxing" P4P slots against fighters the sport actually recognises.
 *
 * Without this, a promotion with FULL card coverage (Misfits: 32/32 events
 * indexed) structurally outranks real pro boxing (Wikipedia's "notable"
 * category: ~15 cards/year) on pure fight-count — not because its fighters
 * are better, but because our data covers them completely and barely covers
 * everyone else. A fighter with even ONE bout outside the promotion is left
 * alone; this only catches fighters whose only evidence IS that promotion.
 */
function excludeSinglePromotionOnly(sportValue: string): Prisma.FighterWhereInput {
  const promotion = SINGLE_PROMOTION_EXCLUSIONS[sportValue];
  if (!promotion) return {};
  return {
    OR: [
      { fightsAsRed: { some: { event: { promotion: { not: promotion } } } } },
      { fightsAsBlue: { some: { event: { promotion: { not: promotion } } } } },
    ],
  };
}

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

/**
 * Generated P4P for a sport.
 *
 * Fighter selection uses `rankableInDiscipline` — verified bout evidence only.
 * The previous `{ sport: sportValue }` ranked on the imported label, which is
 * how the boxing list came to read "#1 Inoue, #2 Crawford, #3 Usyk" off four
 * surname-only stubs with zero bouts between them.
 */
export async function generateP4P(sportValue: string): Promise<GenerateResult> {
  // Never clobber curated (scraped) rankings.
  const curated = await prisma.ranking.count({
    where: { isPoundForPound: true, source: { not: "generated" }, fighter: rankableInDiscipline(sportValue) },
  });
  if (curated > 0) return { sport: sportValue, ranked: 0, unranked: 0, skipped: "curated rankings present" };

  const fighters = await prisma.fighter.findMany({
    where: { ...rankableInDiscipline(sportValue), ...excludeSinglePromotionOnly(sportValue) },
    select: { id: true, wins: true, losses: true, draws: true, noContests: true, koWins: true, totalRounds: true },
  });
  if (fighters.length === 0) return { sport: sportValue, ranked: 0, unranked: 0, skipped: "no fighters" };

  const eligible = fighters
    .filter(isRankable)
    .map((f) => ({
      id: f.id,
      rating: fighterRating(f),
      // The record the rating was computed from — reproducible, not asserted.
      evidence: { wins: f.wins, losses: f.losses, draws: f.draws, noContests: f.noContests, koWins: f.koWins },
    }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, MAX_RANKED);
  const unranked = fighters.length - eligible.length;

  const weightClassId = await ensureP4PWeightClass(sportValue);

  // Atomically replace this sport's generated P4P.
  await prisma.$transaction([
    prisma.ranking.deleteMany({ where: { isPoundForPound: true, source: "generated", fighter: rankableInDiscipline(sportValue) } }),
    ...eligible.map((e, i) =>
      prisma.ranking.create({
        data: {
          weightClassId, fighterId: e.id, isPoundForPound: true,
          rank: i + 1, rating: e.rating, source: "generated", movement: "SAME",
          evidence: e.evidence,
        },
      }),
    ),
  ]);

  // Historical snapshot — Ranking itself gets overwritten on the next
  // generation pass, so this is the only place "what was #1 on this date"
  // survives. Best-effort: a failure here must never fail the generation run
  // that just successfully replaced the live board.
  try {
    await prisma.rankingSnapshot.createMany({
      data: eligible.map((e, i) => ({
        weightClassId, fighterId: e.id, isPoundForPound: true, organisation: "",
        rank: i + 1, rating: e.rating, source: "generated", evidence: e.evidence,
      })),
    });
  } catch (err) {
    console.error(`[rankings] snapshot capture failed for ${sportValue} P4P (board write already committed):`, err);
  }

  return { sport: sportValue, ranked: eligible.length, unranked };
}

export async function generateAllP4P(sportValues: string[]): Promise<GenerateResult[]> {
  const results: GenerateResult[] = [];
  for (const s of sportValues) results.push(await generateP4P(s));
  return results;
}
