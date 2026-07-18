import "server-only";
import { prisma } from "@/lib/db";
import type { CardRarity } from "@prisma/client";

// ── Identity reads ──────────────────────────────────────────────────────────
// The read side of the engine: turns the durable records (reputation, pick
// stats, cards, follows, activity) into the identity surface — profile, result
// reveal, collection. All O(1)/indexed; nothing recomputed on the fly.

export const RARITIES: CardRarity[] = ["LEGEND", "CHAMPION", "EPIC", "RARE", "BASE"];

export interface ProfileStats {
  reputation: number;
  rank: number | null; // position on the reputation board (1 = top)
  accuracy: number; // %
  picksResolved: number;
  picksCorrect: number;
  pickStreak: number;
  bestPickStreak: number;
  cardsTotal: number;
  cardsByRarity: Record<CardRarity, number>;
  followsFighters: number;
  followsPromotions: number;
}

export async function getProfileStats(userId: string): Promise<ProfileStats | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      reputation: true, picksResolved: true, picksCorrect: true, pickStreak: true, bestPickStreak: true,
    },
  });
  if (!u) return null;

  const [ahead, cardGroups, followsFighters, followsPromotions] = await Promise.all([
    // Rank = how many active predictors sit above me + 1.
    prisma.user.count({ where: { picksResolved: { gt: 0 }, reputation: { gt: u.reputation } } }),
    prisma.cardAward.groupBy({ by: ["rarity"], where: { userId }, _count: { rarity: true } }),
    prisma.favoriteFighter.count({ where: { userId } }),
    prisma.favoritePromotion.count({ where: { userId } }),
  ]);

  const cardsByRarity = { LEGEND: 0, CHAMPION: 0, EPIC: 0, RARE: 0, BASE: 0 } as Record<CardRarity, number>;
  let cardsTotal = 0;
  for (const g of cardGroups) { cardsByRarity[g.rarity] = g._count.rarity; cardsTotal += g._count.rarity; }

  return {
    reputation: u.reputation,
    rank: u.picksResolved > 0 ? ahead + 1 : null,
    accuracy: u.picksResolved ? Math.round((u.picksCorrect / u.picksResolved) * 100) : 0,
    picksResolved: u.picksResolved,
    picksCorrect: u.picksCorrect,
    pickStreak: u.pickStreak,
    bestPickStreak: u.bestPickStreak,
    cardsTotal,
    cardsByRarity,
    followsFighters,
    followsPromotions,
  };
}

export interface EventPickSummary {
  graded: number;
  correct: number;
  accuracy: number;
  repGained: number;
  cardsEarned: number;
}

/** The viewer's performance on one event's card — powers the result reveal. */
export async function getEventPickSummary(userId: string, fightIds: string[]): Promise<EventPickSummary | null> {
  if (!fightIds.length) return null;
  const [picks, repAgg, cardsEarned] = await Promise.all([
    prisma.fightPick.findMany({
      where: { userId, fightId: { in: fightIds }, correct: { not: null } },
      select: { correct: true },
    }),
    prisma.reputationEvent.aggregate({
      where: { userId, refType: "fight", refId: { in: fightIds } },
      _sum: { delta: true },
    }),
    prisma.cardAward.count({ where: { userId, fightId: { in: fightIds } } }),
  ]);
  if (!picks.length) return null;
  const correct = picks.filter((p) => p.correct).length;
  return {
    graded: picks.length,
    correct,
    accuracy: Math.round((correct / picks.length) * 100),
    repGained: repAgg._sum.delta ?? 0,
    cardsEarned,
  };
}
