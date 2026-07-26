import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { rarityForFight } from "@/lib/collectibles";
import type { CardRarity } from "@prisma/client";
import {
  predictionHeadline, socialProofLine, methodFamily,
  type CardFacts, type Headline,
} from "@/lib/identity/victory-headline";

// ── Prediction Victory Card — data ──────────────────────────────────────────
// The public artifact generated when a prediction resolves: the thing a user
// wants to post because posting it raises their standing.
//
// ONE data function, used by BOTH the card page and its OG share image, so the
// page and the unfurled preview can never disagree and the work is done once.
// Everything is a stored, point-in-time-exact fact:
//   · correct / method / round  — from the graded Fight + FightPick
//   · reputation gained         — summed from the ReputationEvent ledger for
//                                 THIS fight (never recomputed, never guessed)
//   · crowd share               — a groupBy over the (now stable) pick set
//   · streak                    — the live pickStreak, but ONLY when this is the
//                                 user's latest resolved pick, so the number is
//                                 exactly the run ending at this call
//   · rank / percentile         — the user's current standing
//
// No new table: a card is a projection of records the engine already writes.

export interface VictoryCard {
  headline: Headline;
  socialProof: string | null;
  user: {
    name: string;
    username: string;
    image: string | null;
    reputation: number;
    accuracy: number | null;
    picksResolved: number;
    rank: number | null;
    percentile: number | null;
  };
  pick: {
    corner: "RED" | "BLUE";
    confidence: number | null;
    correct: boolean;
    calledName: string;
    calledImage: string | null;
  };
  fight: {
    slug: string;
    redName: string;
    blueName: string;
    method: string | null;
    roundEnded: number | null;
    titleFight: boolean;
    date: string;
    eventName: string | null;
    eventSlug: string | null;
    promotion: string | null;
  };
  /** Exact reputation delta for this bout (may be 0 / negative-safe). */
  repGained: number;
  rarity: CardRarity;
  /** Share of the crowd (0..100) that picked the winning-called corner. */
  calledByPct: number;
  crowdTotal: number;
  /** Streak ending at this pick, or null when not provable as such. */
  streak: number | null;
}

const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);

/**
 * Build the card for `username`'s call on `fightSlug`, or null when there is no
 * such graded pick (the page 404s — you cannot mint a card for a pick that does
 * not exist or has not resolved). One batched round of reads; no N+1.
 *
 * Wrapped in React `cache()`: the page's `generateMetadata` and its body both
 * need this, and without dedup that is two full runs per request. cache() makes
 * them share one result within a render pass — the OG image is a separate
 * request and runs it once, as intended.
 */
export const getVictoryCard = cache(_getVictoryCard);

async function _getVictoryCard(username: string, fightSlug: string): Promise<VictoryCard | null> {
  const [user, fight] = await Promise.all([
    prisma.user.findUnique({
      where: { username },
      select: {
        id: true, name: true, username: true, image: true,
        reputation: true, picksResolved: true, picksCorrect: true, pickStreak: true,
      },
    }),
    prisma.fight.findUnique({
      where: { slug: fightSlug },
      select: {
        id: true, slug: true, date: true, method: true, roundEnded: true, titleFight: true,
        mainEvent: true, coMain: true, result: true,
        redId: true, blueId: true,
        red: { select: { name: true, imageUrl: true } },
        blue: { select: { name: true, imageUrl: true } },
        event: { select: { name: true, slug: true, promotion: true } },
      },
    }),
  ]);
  if (!user?.username || !fight) return null;

  const pick = await prisma.fightPick.findUnique({
    where: { userId_fightId: { userId: user.id, fightId: fight.id } },
    select: { corner: true, confidence: true, correct: true, method: true },
  });
  // A card exists only for a GRADED pick — correct must be set (true or false).
  if (!pick || pick.correct === null) return null;

  const [repAgg, crowd, ahead, ranked, laterResolved] = await Promise.all([
    // Exact reputation this bout paid this user — the ledger, not a recompute.
    prisma.reputationEvent.aggregate({
      where: { userId: user.id, refType: "fight", refId: fight.id },
      _sum: { delta: true },
    }),
    // The (now stable) crowd split for this bout.
    prisma.fightPick.groupBy({ by: ["corner"], where: { fightId: fight.id }, _count: { _all: true } }),
    // Reputation rank = predictors strictly ahead + 1.
    prisma.user.count({ where: { picksResolved: { gt: 0 }, reputation: { gt: user.reputation } } }),
    prisma.user.count({ where: { picksResolved: { gt: 0 } } }),
    // Is there a LATER resolved pick? If not, the live pickStreak is exactly the
    // run ending at this call, so it is honest to show. Otherwise omit it.
    prisma.fightPick.count({
      where: { userId: user.id, correct: { not: null }, fight: { date: { gt: fight.date } } },
    }),
  ]);

  const total = crowd.reduce((s, c) => s + c._count._all, 0);
  const onCalled = crowd.find((c) => c.corner === pick.corner)?._count._all ?? 0;
  const calledByPct = total > 0 ? Math.round((onCalled / total) * 100) : 0;

  const accuracy = user.picksResolved > 0 ? Math.round((user.picksCorrect / user.picksResolved) * 100) : null;
  const rank = user.picksResolved > 0 ? ahead + 1 : null;
  const percentile = rank && ranked > 0 ? Math.max(1, Math.round((rank / ranked) * 100)) : null;
  const streak = laterResolved === 0 && user.pickStreak > 0 ? user.pickStreak : null;

  const calledRed = pick.corner === "RED";
  const facts: CardFacts = {
    correct: pick.correct,
    calledByPct,
    crowdTotal: total,
    confidence: pick.confidence,
    resultMethod: methodFamily(fight.method),
    calledMethod: methodFamily(pick.method),
    streak,
    titleFight: fight.titleFight,
  };

  return {
    headline: predictionHeadline(facts),
    socialProof: socialProofLine(facts),
    user: {
      name: user.name ?? `@${user.username}`,
      username: user.username,
      image: user.image,
      reputation: user.reputation,
      accuracy,
      picksResolved: user.picksResolved,
      rank,
      percentile,
    },
    pick: {
      corner: pick.corner as "RED" | "BLUE",
      confidence: pick.confidence,
      correct: pick.correct,
      calledName: calledRed ? fight.red.name : fight.blue.name,
      calledImage: calledRed ? fight.red.imageUrl : fight.blue.imageUrl,
    },
    fight: {
      slug: fight.slug,
      redName: fight.red.name,
      blueName: fight.blue.name,
      method: fight.method,
      roundEnded: fight.roundEnded,
      titleFight: fight.titleFight,
      date: fight.date.toISOString(),
      eventName: fight.event?.name ?? null,
      eventSlug: fight.event?.slug ?? null,
      promotion: fight.event?.promotion ?? null,
    },
    repGained: num(repAgg._sum.delta),
    rarity: rarityForFight(fight),
    calledByPct,
    crowdTotal: total,
    streak,
  };
}
