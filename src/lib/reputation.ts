import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications-store";

// ── Reputation ──────────────────────────────────────────────────────────────
// ONE score, many sources. `User.reputation` is the running total; every change
// goes through awardReputation(), which also writes an auditable ledger row.
// Correct picks feed it today; forum upvotes, verified roles and streak
// milestones plug into the SAME function later — never a parallel score.

type Db = Prisma.TransactionClient;

// The pure pick-scoring math lives in the IO-free scoring module so it can be
// unit-tested without a database. Re-exported here to keep reputation's public
// API stable (pickReputation is conceptually part of the reputation system).
export { REP, pickReputation } from "@/lib/intelligence/scoring";

// ── Battle stakes ─────────────────────────────────────────────────────────────
// Winning a Prediction Battle LAYERS onto the same reputation score — it is not a
// separate ledger. Beating a sharper opponent, calling an upset, or beating a more
// confident opponent are all worth more. Losing is a small, non-punishing nick.
export const BATTLE = { BASE: 6, LOSS: 3 } as const;

/** Reputation for winning one battle. */
export function battleReputation(o: {
  opponentAccuracy: number; // 0..100 — the loser's overall accuracy
  winnerWasUnderdog: boolean; // the winner's corner was the crowd minority
  opponentConfidence: number | null; // 1..5
}): number {
  const acc = Math.max(0, Math.min(100, o.opponentAccuracy));
  const accBonus = Math.round((acc / 100) * 8); // beating a sharp caller: up to +8
  const dog = o.winnerWasUnderdog ? 5 : 0; // calling the upset in a duel: +5
  const conf = Math.max(0, (o.opponentConfidence ?? 3) - 3); // silencing a confident opponent: +0..+2
  return BATTLE.BASE + accBonus + dog + conf;
}

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
  const after = await db.user.update({
    where: { id: userId },
    data: { reputation: { increment: delta } },
    select: { reputation: true },
  });
  await notifyRepMilestone(db, userId, after.reputation - delta, after.reputation);
}

// ── Milestones ──────────────────────────────────────────────────────────────
// REP_MILESTONE has been in the NotificationType enum with no producer since it
// was written. It is the one notification that is purely good news, so it is
// worth getting right: told the moment it happens (not on the next cron), and
// exactly once per threshold for the life of the account.

const REP_MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10_000] as const;

/**
 * Announce any threshold crossed by this award.
 *
 * Keyed rep:<threshold>, so a score that dips below a line and climbs back over
 * it does NOT re-announce — a milestone you can farm by losing points first is
 * not a milestone. Only upward crossings qualify; a penalty is never news.
 */
async function notifyRepMilestone(db: Db, userId: string, before: number, after: number): Promise<void> {
  if (after <= before) return;
  const crossed = REP_MILESTONES.filter((m) => before < m && after >= m);
  if (!crossed.length) return;

  // Award the highest line crossed. A single huge payout that clears two
  // thresholds is one achievement, not two notifications.
  const top = crossed[crossed.length - 1];
  await notify(db, userId, {
    type: "REP_MILESTONE",
    title: `${top.toLocaleString()} reputation`,
    body: "Your calls are paying off. See where that puts you on the board.",
    url: "/leaderboard",
    icon: "⭐",
    dedupeKey: `rep:${top}`,
  });
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

// ── Windowed leaderboards ───────────────────────────────────────────────────
// "All time" is User.reputation, the running total. A month or a year cannot be
// read off that column, so those windows sum the LEDGER — which is precisely
// what the ledger is for. Same score, same rules, narrower slice of time.

export type LeaderWindow = "all" | "year" | "month";

export const LEADER_WINDOWS: { id: LeaderWindow; label: string }[] = [
  { id: "all", label: "All Time" },
  { id: "month", label: "This Month" },
  { id: "year", label: "This Year" },
];

export interface Leader {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  /** Points inside the selected window. */
  points: number;
  picksResolved: number;
  picksCorrect: number;
  bestPickStreak: number;
  /** Whole-percent accuracy, all-time (a month of picks is too thin to rank on). */
  accuracy: number;
}

/** Start of the current month / year, or null for all-time. */
function windowStart(w: LeaderWindow): Date | null {
  const now = new Date();
  if (w === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (w === "year") return new Date(now.getFullYear(), 0, 1);
  return null;
}

const accuracyOf = (correct: number, resolved: number) =>
  resolved > 0 ? Math.round((correct / resolved) * 100) : 0;

/**
 * The predictor board for one time window.
 *
 * All-time reads the denormalised column. A window groups the ledger by user,
 * takes the top N, then fetches those users — two indexed queries whose cost is
 * set by the window, never by how many users exist.
 */
export async function getLeaderboard(w: LeaderWindow, limit = 50): Promise<Leader[]> {
  const since = windowStart(w);

  if (!since) {
    const rows = await getReputationLeaders(limit);
    return rows.map((u) => ({
      id: u.id, name: u.name, username: u.username, image: u.image,
      points: u.reputation,
      picksResolved: u.picksResolved, picksCorrect: u.picksCorrect,
      bestPickStreak: u.bestPickStreak,
      accuracy: accuracyOf(u.picksCorrect, u.picksResolved),
    }));
  }

  const grouped = await prisma.reputationEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { delta: true },
    orderBy: { _sum: { delta: "desc" } },
    take: limit,
  });
  // A window can net out to zero or negative; a board of people who lost points
  // is not a leaderboard.
  const scored = grouped.filter((g) => (g._sum.delta ?? 0) > 0);
  if (scored.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: scored.map((g) => g.userId) } },
    select: {
      id: true, name: true, username: true, image: true,
      picksResolved: true, picksCorrect: true, bestPickStreak: true,
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return scored.flatMap((g) => {
    const u = byId.get(g.userId);
    if (!u) return []; // deleted between the two reads
    return [{
      id: u.id, name: u.name, username: u.username, image: u.image,
      points: g._sum.delta ?? 0,
      picksResolved: u.picksResolved, picksCorrect: u.picksCorrect,
      bestPickStreak: u.bestPickStreak,
      accuracy: accuracyOf(u.picksCorrect, u.picksResolved),
    }];
  });
}
