import "server-only";
import { cache } from "react";
import type { FightMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { winnerCorner } from "@/lib/intelligence/scoring";
import { methodFamily, QUORUM, type MethodFamily } from "@/lib/identity/victory-headline";
import { publicDisplayName } from "@/lib/display-name";

// ── The Room — how the community called it ──────────────────────────────────
// The community complement to ResultReveal: after a headline bout resolves, how
// did the ROOM do? Every number is a straight count over FightPick — winner /
// finish / perfect-call shares, mean confidence, the sharpest caller who nailed
// it, and the perfect-call club. No AI, no fabrication; if the crowd is below
// quorum the whole section stays hidden rather than quote noise.
//
// Reuse: winnerCorner + methodFamily (pure), the QUORUM constant. Self-contained
// (one fight lookup + bounded aggregates), cache()'d for the event page.

// FightMethod values whose family matches — used to count "called the finish".
const FAMILY_METHODS: Record<MethodFamily, FightMethod[]> = {
  KO: ["KO", "TKO"],
  SUB: ["SUB", "RTD"],
  DEC: ["UD", "SD", "MD", "TD"],
};

export interface RoomCaller {
  name: string;
  username: string | null;
  image: string | null;
  reputation: number;
}

export interface EventRoom {
  winnerName: string;
  loserName: string;
  crowdTotal: number;
  /** Share (0..100) who called the winning corner. */
  winnerPickedPct: number;
  /** Share (0..100) who called the winning method family, or null if no finish. */
  finishPickedPct: number | null;
  /** Share (0..100) who called BOTH winner and method. */
  perfectPct: number;
  /** Count who called both — the "perfect call club". */
  perfectCount: number;
  /** Mean confidence across picks that set one (0..5), or null. */
  avgConfidence: number | null;
  /** How many called the winner (i.e. were correct on this bout). */
  correctCount: number;
  /** The highest-reputation caller who got it right. */
  topCaller: RoomCaller | null;
}

export const getEventRoom = cache(_getEventRoom);

async function _getEventRoom(headlineFightId: string): Promise<EventRoom | null> {
  const fight = await prisma.fight.findUnique({
    where: { id: headlineFightId },
    select: {
      id: true, result: true, winnerId: true, redId: true, blueId: true, method: true,
      red: { select: { name: true, slug: true } },
      blue: { select: { name: true, slug: true } },
    },
  });
  if (!fight) return null;

  const corner = winnerCorner(fight); // "RED" | "BLUE" | null (draw/NC ⇒ no room)
  if (!corner) return null;
  const winFamily = methodFamily(fight.method);
  const winMethods = winFamily ? FAMILY_METHODS[winFamily] : [];

  const [byCorner, byMethod, perfectCount, top] = await Promise.all([
    prisma.fightPick.groupBy({ by: ["corner"], where: { fightId: fight.id }, _count: { _all: true }, _avg: { confidence: true } }),
    winMethods.length
      ? prisma.fightPick.count({ where: { fightId: fight.id, method: { in: winMethods } } })
      : Promise.resolve(0),
    winMethods.length
      ? prisma.fightPick.count({ where: { fightId: fight.id, corner, method: { in: winMethods } } })
      : Promise.resolve(0),
    // The sharpest caller who got it right — join to the user for reputation.
    prisma.fightPick.findMany({
      where: { fightId: fight.id, corner, correct: true },
      orderBy: { user: { reputation: "desc" } },
      take: 1,
      select: { user: { select: { name: true, username: true, image: true, reputation: true } } },
    }),
  ]);

  const total = byCorner.reduce((s, c) => s + c._count._all, 0);
  if (total < QUORUM) return null; // below quorum: no room to show

  const onWinner = byCorner.find((c) => c.corner === corner)?._count._all ?? 0;
  const confW = byCorner.reduce(
    (a, c) => (c._avg.confidence != null ? { sum: a.sum + c._avg.confidence * c._count._all, n: a.n + c._count._all } : a),
    { sum: 0, n: 0 },
  );

  const pct = (n: number) => Math.round((n / total) * 100);
  const winnerName = corner === "RED" ? fight.red.name : fight.blue.name;
  const loserName = corner === "RED" ? fight.blue.name : fight.red.name;
  const u = top[0]?.user;

  return {
    winnerName,
    loserName,
    crowdTotal: total,
    winnerPickedPct: pct(onWinner),
    finishPickedPct: winMethods.length ? pct(byMethod) : null,
    perfectPct: pct(perfectCount),
    perfectCount,
    avgConfidence: confW.n > 0 ? Math.round((confW.sum / confW.n) * 10) / 10 : null,
    correctCount: onWinner,
    topCaller: u ? { name: publicDisplayName(u), username: u.username, image: u.image, reputation: u.reputation } : null,
  };
}
