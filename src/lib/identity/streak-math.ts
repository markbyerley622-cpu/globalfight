// Pure day-streak math. NO `server-only`, NO prisma — the deterministic core of
// the daily habit loop, extracted from streak.ts so the rule can be unit-tested
// without a database (the same split scoring.ts uses for the pick engine).
//
// Rules, chosen so the number is always defensible to the person holding it:
//   · a DAY is a UTC midnight, not an instant — otherwise a streak breaks at
//     23:59 and survives at 00:01 with no explanation a user would accept
//   · showing up twice in one day is one day (idempotent)
//   · yesterday → +1; a gap of two or more days → back to 1, not 0, because the
//     day you returned is itself a day you showed up
//   · `activeDays` never decreases — it is the lifetime record, and the thing a
//     twenty-year profile is actually made of

/** UTC midnight for the day containing `d`. The canonical "day" everywhere here. */
export function dayKey(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days between two day-keys. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export interface StreakCounters {
  lastActiveOn: Date | null;
  dayStreak: number;
  bestDayStreak: number;
  activeDays: number;
}

export interface StreakState {
  /** Consecutive days including today. */
  streak: number;
  best: number;
  /** Lifetime distinct days active. */
  activeDays: number;
  /** True when this visit was the FIRST of the day — the only time to celebrate. */
  advancedToday: boolean;
  /** True when a gap ended a streak (so the UI can be honest instead of silent). */
  reset: boolean;
  /** The streak that was lost, when `reset`. Zero otherwise. */
  lostStreak: number;
  /**
   * The day this user was last here BEFORE this visit — null on the first ever.
   * The digest is built from this: "since you were last here" has to mean the
   * previous visit, not the one happening right now.
   */
  previousActiveOn: Date | null;
}

/** What the counters become when a user shows up on `today` (a day-key). */
export function advanceStreak(prev: StreakCounters, today: Date): StreakState {
  const last = prev.lastActiveOn ? dayKey(prev.lastActiveOn) : null;
  const gap = last ? daysBetween(last, today) : null;

  // Already counted today (gap 0), or a future `lastActiveOn` from clock skew
  // or a hand-edited row — treat both as "already counted" rather than
  // inventing a negative gap. Nothing moves.
  if (gap !== null && gap <= 0) {
    return {
      streak: prev.dayStreak,
      best: prev.bestDayStreak,
      activeDays: prev.activeDays,
      advancedToday: false,
      reset: false,
      lostStreak: 0,
      previousActiveOn: prev.lastActiveOn,
    };
  }

  const continued = gap === 1;
  const streak = continued ? prev.dayStreak + 1 : 1;
  const broke = last !== null && !continued;
  return {
    streak,
    best: Math.max(prev.bestDayStreak, streak),
    activeDays: prev.activeDays + 1,
    advancedToday: true,
    // A first-ever visit is not a "reset" — there was no streak to lose. Nor is
    // returning after a gap when the old streak was a single day.
    reset: broke && prev.dayStreak > 1,
    lostStreak: broke ? prev.dayStreak : 0,
    previousActiveOn: prev.lastActiveOn,
  };
}

/**
 * The streak to DISPLAY, which is not always the stored one: nothing rewrites a
 * row for absence, so a user who stopped visiting still carries yesterday's
 * number in the column. A streak older than yesterday is over.
 */
export function liveStreak(prev: StreakCounters, now: Date): number {
  if (!prev.lastActiveOn) return 0;
  const gap = daysBetween(dayKey(prev.lastActiveOn), dayKey(now));
  return gap > 1 || gap < 0 ? 0 : prev.dayStreak;
}

/** Streaks below this aren't worth a reminder — a 1–2 day run isn't yet a habit
 *  and warning about it reads as spam to a casual new user. */
export const STREAK_WARN_MIN = 3;

/**
 * Is this streak ALIVE but not yet extended today — i.e. it breaks at the next
 * UTC midnight unless the user shows up? The one condition a "keep your streak"
 * reminder is allowed to fire on.
 *
 *   gap 0  → already visited today (safe, nothing to warn)
 *   gap 1  → visited yesterday, not today → AT RISK → warn
 *   gap >1 → already broken (liveStreak is 0); the column is just stale
 *
 * Pure so the Return Engine's decision is unit-tested without a database.
 */
export function streakWarningDue(
  prev: Pick<StreakCounters, "dayStreak" | "lastActiveOn">,
  now: Date,
): boolean {
  if (!prev.lastActiveOn || prev.dayStreak < STREAK_WARN_MIN) return false;
  return daysBetween(dayKey(prev.lastActiveOn), dayKey(now)) === 1;
}
