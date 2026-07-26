import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceStreak, dayKey, daysBetween, liveStreak, streakWarningDue, STREAK_WARN_MIN, type StreakCounters } from "../streak-math";

// The day-streak rule. A streak is the only counter in the product a user moves
// by turning up, so an off-by-one here is the difference between "I have a
// 40-day run" and "this app lost my run" — the exact failure that makes someone
// stop opening it.

const D = (iso: string) => new Date(iso);
const at = (over: Partial<StreakCounters> = {}): StreakCounters => ({
  lastActiveOn: null,
  dayStreak: 0,
  bestDayStreak: 0,
  activeDays: 0,
  ...over,
});

// ── dayKey / daysBetween ────────────────────────────────────────────────────

test("dayKey: collapses any instant to that day's UTC midnight", () => {
  assert.equal(dayKey(D("2026-07-26T23:59:59.999Z")).toISOString(), "2026-07-26T00:00:00.000Z");
  assert.equal(dayKey(D("2026-07-26T00:00:00.000Z")).toISOString(), "2026-07-26T00:00:00.000Z");
});

test("daysBetween: consecutive days are 1 apart, across a month boundary", () => {
  assert.equal(daysBetween(dayKey(D("2026-07-31T12:00:00Z")), dayKey(D("2026-08-01T03:00:00Z"))), 1);
});

test("daysBetween: unaffected by a DST-style clock shift within the day", () => {
  // Same two UTC days, wildly different local times.
  assert.equal(daysBetween(dayKey(D("2026-03-28T00:30:00Z")), dayKey(D("2026-03-29T23:30:00Z"))), 1);
});

// ── advanceStreak ───────────────────────────────────────────────────────────

test("first ever visit: day one, and NOT reported as a reset", () => {
  const s = advanceStreak(at(), dayKey(D("2026-07-26T09:00:00Z")));
  assert.equal(s.streak, 1);
  assert.equal(s.best, 1);
  assert.equal(s.activeDays, 1);
  assert.equal(s.advancedToday, true);
  assert.equal(s.reset, false);
  assert.equal(s.previousActiveOn, null);
});

test("yesterday → the streak continues", () => {
  const s = advanceStreak(
    at({ lastActiveOn: D("2026-07-25T00:00:00Z"), dayStreak: 4, bestDayStreak: 9, activeDays: 30 }),
    dayKey(D("2026-07-26T06:00:00Z")),
  );
  assert.equal(s.streak, 5);
  assert.equal(s.best, 9, "best only moves when the current run passes it");
  assert.equal(s.activeDays, 31);
  assert.equal(s.advancedToday, true);
});

test("a run that passes the record raises the record", () => {
  const s = advanceStreak(
    at({ lastActiveOn: D("2026-07-25T00:00:00Z"), dayStreak: 9, bestDayStreak: 9, activeDays: 40 }),
    dayKey(D("2026-07-26T00:00:00Z")),
  );
  assert.equal(s.streak, 10);
  assert.equal(s.best, 10);
});

test("second visit the same day changes nothing", () => {
  const prev = at({ lastActiveOn: D("2026-07-26T00:00:00Z"), dayStreak: 5, bestDayStreak: 9, activeDays: 31 });
  const s = advanceStreak(prev, dayKey(D("2026-07-26T22:00:00Z")));
  assert.equal(s.advancedToday, false);
  assert.equal(s.streak, 5);
  assert.equal(s.activeDays, 31, "a day is counted once, however many times you look");
});

test("a two-day gap restarts at 1 — the day you came back still counts", () => {
  const s = advanceStreak(
    at({ lastActiveOn: D("2026-07-23T00:00:00Z"), dayStreak: 12, bestDayStreak: 12, activeDays: 60 }),
    dayKey(D("2026-07-26T00:00:00Z")),
  );
  assert.equal(s.streak, 1);
  assert.equal(s.best, 12, "losing a run never lowers the record");
  assert.equal(s.activeDays, 61, "lifetime days never decrease");
  assert.equal(s.reset, true);
  assert.equal(s.lostStreak, 12);
});

test("losing a one-day 'streak' is not announced as a reset", () => {
  const s = advanceStreak(
    at({ lastActiveOn: D("2026-07-20T00:00:00Z"), dayStreak: 1, bestDayStreak: 3, activeDays: 5 }),
    dayKey(D("2026-07-26T00:00:00Z")),
  );
  assert.equal(s.streak, 1);
  assert.equal(s.reset, false, "there was nothing worth telling them they lost");
});

test("a lastActiveOn in the future (clock skew) is treated as already counted", () => {
  const s = advanceStreak(
    at({ lastActiveOn: D("2026-07-28T00:00:00Z"), dayStreak: 3, bestDayStreak: 3, activeDays: 10 }),
    dayKey(D("2026-07-26T00:00:00Z")),
  );
  assert.equal(s.advancedToday, false);
  assert.equal(s.streak, 3);
  assert.equal(s.activeDays, 10, "never invents a day from a bad clock");
});

test("previousActiveOn is the visit BEFORE this one — the digest window", () => {
  const last = D("2026-07-24T08:00:00Z");
  const s = advanceStreak(at({ lastActiveOn: last, dayStreak: 2, bestDayStreak: 2, activeDays: 2 }), dayKey(D("2026-07-26T00:00:00Z")));
  assert.equal(s.previousActiveOn?.toISOString(), last.toISOString());
});

// ── liveStreak ──────────────────────────────────────────────────────────────

test("liveStreak: a stored streak the user has already dropped displays as 0", () => {
  // Nothing rewrites rows for absence, so the column still says 12.
  const prev = at({ lastActiveOn: D("2026-07-20T00:00:00Z"), dayStreak: 12, bestDayStreak: 12, activeDays: 40 });
  assert.equal(liveStreak(prev, D("2026-07-26T10:00:00Z")), 0);
});

test("liveStreak: yesterday's visit still counts — the day is not over", () => {
  const prev = at({ lastActiveOn: D("2026-07-25T00:00:00Z"), dayStreak: 12, bestDayStreak: 12, activeDays: 40 });
  assert.equal(liveStreak(prev, D("2026-07-26T10:00:00Z")), 12);
});

test("liveStreak: today's visit counts", () => {
  const prev = at({ lastActiveOn: D("2026-07-26T00:00:00Z"), dayStreak: 12, bestDayStreak: 12, activeDays: 40 });
  assert.equal(liveStreak(prev, D("2026-07-26T23:00:00Z")), 12);
});

test("liveStreak: never visited → 0", () => {
  assert.equal(liveStreak(at(), D("2026-07-26T10:00:00Z")), 0);
});

// ── streakWarningDue — the "keep your streak" trigger ────────────────────────

const warn = (dayStreak: number, lastActiveOn: Date | null) =>
  streakWarningDue({ dayStreak, lastActiveOn }, D("2026-07-26T18:00:00Z"));

test("warn: alive yesterday, not yet today, worth protecting → true", () => {
  assert.equal(warn(5, D("2026-07-25T00:00:00Z")), true);
});

test("warn: already visited today → false (nothing at risk)", () => {
  assert.equal(warn(5, D("2026-07-26T09:00:00Z")), false);
});

test("warn: streak already broken (gap > 1) → false, not resurrected", () => {
  assert.equal(warn(5, D("2026-07-23T00:00:00Z")), false);
});

test("warn: streak below the minimum is not worth a push", () => {
  assert.equal(warn(STREAK_WARN_MIN - 1, D("2026-07-25T00:00:00Z")), false);
  assert.equal(warn(STREAK_WARN_MIN, D("2026-07-25T00:00:00Z")), true);
});

test("warn: never visited → false", () => {
  assert.equal(warn(5, null), false);
});

test("warn: a lastActiveOn later in yesterday still counts as yesterday", () => {
  // Stored value is a UTC-midnight day-key, but be robust to any yesterday instant.
  assert.equal(warn(4, D("2026-07-25T23:30:00Z")), true);
});
