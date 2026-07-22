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
  CORRECT_BASE: 4, // floor for a correct pick — calling an obvious favourite earns little
  UPSET_BONUS: 16, // added × upsetFactor — the reward is for calling against the crowd
  STREAK_STEP: 2, // × min(streak, 5) — bonus that grows with a hot streak
} as const;

/**
 * Reputation for one correct pick — rewards SKILL over volume.
 *
 *   points = (CORRECT_BASE + UPSET_BONUS·upset) · confidenceMultiplier + streakBonus
 *
 * - `upsetFactor` (0..1) is the share of the crowd that got it WRONG, so calling
 *   an obvious favourite (everyone agreed) pays ~the floor while calling a genuine
 *   upset pays up to ~5× — this is what kills favourite-farming: you can still
 *   grind chalk, it just earns almost nothing, so the leaderboard ranks callers.
 * - confidence is a legible multiplier, neutral (×1.0) at 3★, 0.8..1.2 across 1–5★.
 *   (No downside on a WRONG high-confidence pick yet — calibration risk is a
 *   deliberate P1 follow-up; the upset scaling already removes the main exploit.)
 */
export function pickReputation(opts: { upsetFactor: number; confidence: number | null; streak: number }): number {
  const upset = Math.max(0, Math.min(1, opts.upsetFactor));
  const conf = opts.confidence ?? 3; // neutral when the user left confidence unset
  const base = REP.CORRECT_BASE + Math.round(REP.UPSET_BONUS * upset);
  const confMult = 0.7 + 0.1 * conf; // 1★→0.8 … 3★→1.0 … 5★→1.2
  const streakBonus = Math.min(opts.streak, 5) * REP.STREAK_STEP;
  return Math.round(base * confMult) + streakBonus;
}

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
