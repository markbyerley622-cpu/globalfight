// Pure scoring + resolution math for the prediction engine. NO `server-only`,
// NO prisma — this is the deterministic core that decides who won, how much of
// the crowd was wrong, and what a correct pick pays. It is extracted from
// resolve.ts / reputation.ts precisely so it can be unit-tested without a
// database; those modules are the IO wrappers around these functions.

export type WinCorner = "RED" | "BLUE";

/** Minimal shape `winnerCorner` needs — a structural subset of a loaded Fight. */
export interface FightOutcome {
  result: string;
  winnerId: string | null;
  redId: string;
  blueId: string;
  red: { slug: string };
  blue: { slug: string };
}

/**
 * Winning corner, robust to `winnerId` being stored as a Fighter id OR a slug.
 * Returns null for anything that is not a decisive WIN (draw, no-contest,
 * scheduled, or a winnerId that matches neither corner).
 */
export function winnerCorner(f: FightOutcome): WinCorner | null {
  if (f.result !== "WIN" || !f.winnerId) return null;
  const w = f.winnerId;
  if (w === f.redId || w === f.red.slug) return "RED";
  if (w === f.blueId || w === f.blue.slug) return "BLUE";
  return null;
}

/**
 * Upset factor = the share of the crowd that got the bout WRONG (0..1). It
 * scales the reputation reward so calling an obvious favourite pays the floor
 * and calling a genuine upset pays far more — the anti-farming lever. Neutral
 * 0.5 when the bout is void or nobody picked.
 */
export function upsetFactor(picksOnWinner: number, totalPicks: number, decisive: boolean): number {
  if (!decisive || totalPicks <= 0) return 0.5;
  return 1 - picksOnWinner / totalPicks;
}

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
 *   upset pays up to ~5× — this is what kills favourite-farming.
 * - confidence is a legible multiplier, neutral (×1.0) at 3★, 0.8..1.2 across 1–5★.
 */
export function pickReputation(opts: { upsetFactor: number; confidence: number | null; streak: number }): number {
  const upset = Math.max(0, Math.min(1, opts.upsetFactor));
  const conf = opts.confidence ?? 3; // neutral when the user left confidence unset
  const base = REP.CORRECT_BASE + Math.round(REP.UPSET_BONUS * upset);
  const confMult = 0.7 + 0.1 * conf; // 1★→0.8 … 3★→1.0 … 5★→1.2
  const streakBonus = Math.min(opts.streak, 5) * REP.STREAK_STEP;
  return Math.round(base * confMult) + streakBonus;
}
