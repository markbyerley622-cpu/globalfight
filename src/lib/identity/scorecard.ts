import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  scorecardHeadline, scorecardBadges, isPerfect,
  type ScorecardBadge, type ScorecardFacts,
} from "@/lib/identity/scorecard-format";

// ── Event Scorecard — the shareable "how my card went" ──────────────────────
// The personal-night companion to The Room (the community's night) and the
// per-pick Victory Card. It answers "how did I do on this card" as a permanent,
// shareable artifact. Everything is the viewer's OWN graded record on ONE
// completed event — no claims about the fights beyond the verified results they
// called against.
//
// Reads the graded picks ONCE (with fighter names) and derives the aggregates,
// rather than calling getEventPickSummary and re-reading the same rows; rep,
// cards and rank are bounded batched reads. cache()'d for page + OG image.

export interface ScorecardBout {
  fighterCalled: string;
  opponent: string;
  correct: boolean;
  main: boolean;
}

export interface EventScorecard {
  headline: string;
  perfect: boolean;
  badges: ScorecardBadge[];
  user: {
    name: string;
    username: string;
    image: string | null;
    reputation: number;
    rank: number | null;
    percentile: number | null;
  };
  event: { name: string; slug: string; promotion: string | null; date: string };
  graded: number;
  correct: number;
  accuracy: number;
  repGained: number;
  cardsEarned: number;
  /** Per-bout story, main event first, bounded. */
  bouts: ScorecardBout[];
}

const BOUT_CAP = 14; // a graded card rarely exceeds this; bounds the payload

export const getEventScorecard = cache(_getEventScorecard);

async function _getEventScorecard(username: string, eventSlug: string): Promise<EventScorecard | null> {
  const [user, event] = await Promise.all([
    prisma.user.findUnique({
      where: { username },
      select: { id: true, name: true, username: true, image: true, reputation: true, picksResolved: true },
    }),
    prisma.event.findUnique({
      where: { slug: eventSlug },
      select: { id: true, name: true, slug: true, promotion: true, date: true, status: true },
    }),
  ]);
  if (!user?.username || !event) return null;
  // A scorecard is a POST-fight artifact: only a completed card, never a preview.
  if (event.status !== "COMPLETED") return null;

  const picks = await prisma.fightPick.findMany({
    where: { userId: user.id, correct: { not: null }, fight: { eventId: event.id } },
    orderBy: [{ fight: { mainEvent: "desc" } }, { fight: { orderOnCard: "asc" } }],
    take: BOUT_CAP,
    select: {
      correct: true, corner: true, fightId: true,
      fight: { select: { mainEvent: true, red: { select: { name: true } }, blue: { select: { name: true } } } },
    },
  });
  if (picks.length === 0) return null; // no graded picks on this card → no scorecard

  const graded = picks.length;
  const correct = picks.filter((p) => p.correct).length;
  const accuracy = Math.round((correct / graded) * 100);
  const calledMain = picks.some((p) => p.fight.mainEvent && p.correct);
  const correctFightIds = picks.filter((p) => p.correct).map((p) => p.fightId);

  const [repAgg, cardsEarned, ahead, ranked] = await Promise.all([
    correctFightIds.length
      ? prisma.reputationEvent.aggregate({
          where: { userId: user.id, refType: "fight", refId: { in: correctFightIds } },
          _sum: { delta: true },
        })
      : Promise.resolve({ _sum: { delta: 0 } }),
    correctFightIds.length
      ? prisma.cardAward.count({ where: { userId: user.id, fightId: { in: correctFightIds } } })
      : Promise.resolve(0),
    prisma.user.count({ where: { picksResolved: { gt: 0 }, reputation: { gt: user.reputation } } }),
    prisma.user.count({ where: { picksResolved: { gt: 0 } } }),
  ]);

  const rank = user.picksResolved > 0 ? ahead + 1 : null;
  const percentile = rank && ranked > 0 ? Math.max(1, Math.round((rank / ranked) * 100)) : null;
  const repGained = repAgg._sum.delta ?? 0;

  const facts: ScorecardFacts = { graded, correct, calledMain, cardsEarned, repGained, accuracy };

  return {
    headline: scorecardHeadline(facts),
    perfect: isPerfect(facts),
    badges: scorecardBadges(facts),
    user: {
      name: user.name ?? `@${user.username}`,
      username: user.username,
      image: user.image,
      reputation: user.reputation,
      rank,
      percentile,
    },
    event: { name: event.name, slug: event.slug, promotion: event.promotion, date: event.date.toISOString() },
    graded,
    correct,
    accuracy,
    repGained,
    cardsEarned,
    bouts: picks.map((p): ScorecardBout => ({
      fighterCalled: p.corner === "RED" ? p.fight.red.name : p.fight.blue.name,
      opponent: p.corner === "RED" ? p.fight.blue.name : p.fight.red.name,
      correct: !!p.correct,
      main: p.fight.mainEvent,
    })),
  };
}
