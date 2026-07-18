import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// ── Reputation ──────────────────────────────────────────────────────────────
// ONE score, many sources. `User.reputation` is the running total; every change
// goes through awardReputation(), which also writes an auditable ledger row.
// Correct picks feed it today; forum upvotes, verified roles and streak
// milestones plug into the SAME function later — never a parallel score.

type Db = Prisma.TransactionClient;

export const REP = {
  PICK_CORRECT: 8, // base for a correct pick
  STREAK_STEP: 2, // × min(streak, 5) — bonus that grows with a hot streak
} as const;

/** Apply a reputation delta and record why. No-op for a zero delta. */
export async function awardReputation(
  db: Db,
  userId: string,
  delta: number,
  reason: string,
  ref?: { type?: string; id?: string },
): Promise<void> {
  if (!delta) return;
  await db.reputationEvent.create({
    data: { userId, delta, reason, refType: ref?.type ?? null, refId: ref?.id ?? null },
  });
  await db.user.update({ where: { id: userId }, data: { reputation: { increment: delta } } });
}

/** Reputation leaderboard — highest first. */
export async function getReputationLeaders(limit = 25) {
  return prisma.user.findMany({
    where: { picksResolved: { gt: 0 } },
    orderBy: [{ reputation: "desc" }, { bestPickStreak: "desc" }],
    take: limit,
    select: {
      id: true, name: true, username: true, image: true, reputation: true,
      picksResolved: true, picksCorrect: true, pickStreak: true, bestPickStreak: true,
    },
  });
}
