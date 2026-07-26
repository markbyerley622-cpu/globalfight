import "server-only";
import { prisma } from "@/lib/db";
import { advanceStreak, dayKey, liveStreak, type StreakState } from "@/lib/identity/streak-math";

// ── The daily habit loop (IO side) ──────────────────────────────────────────
// Everything else that scores a user moves only when a FIGHT happens: picks
// grade on fight night, reputation follows the picks, battles follow the picks.
// That makes the product event-shaped — there is nothing to come back FOR on a
// Tuesday. The day streak is the one counter a user moves by turning up.
//
// The rules live in streak-math.ts; this file is the database wrapper.

const EMPTY: StreakState = {
  streak: 0, best: 0, activeDays: 0, advancedToday: false, reset: false, lostStreak: 0, previousActiveOn: null,
};

const SELECT = { lastActiveOn: true, dayStreak: true, bestDayStreak: true, activeDays: true } as const;

/**
 * Record that `userId` showed up, and return the resulting counters.
 *
 * Called from the Today surface — the one page whose entire job is "you turned
 * up" — so the cost is one read plus at most one write per user per day: the
 * second visit of a day reads and returns without writing.
 */
export async function touchDailyStreak(userId: string, now = new Date()): Promise<StreakState> {
  const today = dayKey(now);
  const u = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!u) return EMPTY;

  const next = advanceStreak(u, today);
  if (!next.advancedToday) return next;

  // Guarded on lastActiveOn so two concurrent first-visits of a day cannot both
  // increment: the loser matches zero rows.
  const written = await prisma.user.updateMany({
    where: { id: userId, OR: [{ lastActiveOn: null }, { lastActiveOn: { lt: today } }] },
    data: {
      lastActiveOn: today,
      dayStreak: next.streak,
      bestDayStreak: next.best,
      activeDays: next.activeDays,
    },
  });
  if (written.count === 0) {
    // Lost the race — the other request already counted today, so this visit
    // celebrates nothing.
    return { ...next, advancedToday: false, reset: false, lostStreak: 0 };
  }
  return next;
}

/** Read-only counters, for surfaces that show a streak without claiming a visit. */
export async function getStreak(userId: string): Promise<StreakState> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!u) return EMPTY;
  return {
    streak: liveStreak(u, new Date()),
    best: u.bestDayStreak,
    activeDays: u.activeDays,
    advancedToday: false,
    reset: false,
    lostStreak: 0,
    previousActiveOn: u.lastActiveOn,
  };
}

export type { StreakState };
