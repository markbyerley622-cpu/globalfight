// ════════════════════════════════════════════════════════════════════════
//  Combat rating engine — sport-agnostic. Turns a fighter's record into a
//  0–100 rating and decides eligibility. Pure functions, no I/O, so they're
//  trivially testable and run identically in any job.
//
//  Philosophy: every fighter is eligible in principle, but a fighter needs a
//  minimum body of verified results before they're ranked — a brand-new
//  signup with an empty record is UNRANKED, never #1.
// ════════════════════════════════════════════════════════════════════════

export const MIN_FIGHTS_FOR_RANKING = 3;

export interface RatedRecord {
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  koWins: number;
  totalRounds: number;
}

export function totalFights(f: RatedRecord): number {
  return f.wins + f.losses + f.draws + f.noContests;
}

/** A fighter is rankable once they have a minimum number of recorded bouts. */
export function isRankable(f: RatedRecord): boolean {
  return totalFights(f) >= MIN_FIGHTS_FOR_RANKING;
}

/**
 * 0–100 rating. Rewards win rate and finishing, scaled by sample size so a
 * 20-1 fighter outranks a 3-0 fighter, and penalises losses modestly.
 */
export function fighterRating(f: RatedRecord): number {
  const fights = totalFights(f);
  if (fights === 0) return 0;
  const winRate = f.wins / fights;
  const koRate = f.wins > 0 ? f.koWins / f.wins : 0;
  const confidence = Math.min(1, fights / 25); // full confidence at ~25 bouts
  const score =
    40 +
    winRate * 45 +
    koRate * 8 +
    confidence * 9 -
    f.losses * 0.7;
  return Math.max(0, Math.min(100, Number(score.toFixed(1))));
}
