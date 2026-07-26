// Pure formatting for the Event Scorecard — the shareable "how my card went".
// NO server-only, NO prisma, so the logic is unit-tested without a database
// (same split as victory-headline / victory-badges).
//
// Every value describes the USER'S OWN performance on a completed card — their
// record, their reputation, their cards. It never characterises the fights
// themselves (no invented momentum, finishes or drama). Truth about the user's
// night, nothing about the bouts beyond the verified result they picked against.

import type { BadgeTier } from "@/lib/identity/victory-badges";

export interface ScorecardFacts {
  graded: number;
  correct: number;
  /** Did they call the main event's winner? (false when they didn't pick it.) */
  calledMain: boolean;
  cardsEarned: number;
  repGained: number;
  /** Whole-percent accuracy on THIS card. */
  accuracy: number;
}

export interface ScorecardBadge {
  label: string;
  tier: BadgeTier;
}

/** True when every graded call on the card landed (and there were at least two —
 *  one is a single call, not a "card"). */
export function isPerfect(f: Pick<ScorecardFacts, "graded" | "correct">): boolean {
  return f.graded >= 2 && f.correct === f.graded;
}

/**
 * The hero line — a short, honest summary of the user's night. Leads on the
 * record; the big number is rendered separately.
 */
export function scorecardHeadline(f: Pick<ScorecardFacts, "graded" | "correct">): string {
  if (f.graded <= 0) return "No calls graded";
  if (isPerfect(f)) return "Perfect card.";
  if (f.graded === 1) return f.correct === 1 ? "Nailed it." : "Missed it.";
  const acc = f.correct / f.graded;
  if (f.correct === 0) return "Tough card.";
  if (acc >= 0.7) return "Sharp card.";
  if (acc >= 0.5) return "Solid card.";
  return "On the board.";
}

/**
 * Supporting achievement chips — only objectively-true facts about the card,
 * richest first, capped. The record itself is the hero, so these ADD context
 * (main event, cards earned, accuracy) rather than repeat the score.
 */
export function scorecardBadges(f: ScorecardFacts, limit = 3): ScorecardBadge[] {
  const out: ScorecardBadge[] = [];
  const perfect = isPerfect(f);

  if (perfect) out.push({ label: "Perfect card", tier: "elite" });
  if (f.calledMain) out.push({ label: "Called the main event", tier: perfect ? "strong" : "elite" });
  if (f.cardsEarned > 0) {
    out.push({ label: `${f.cardsEarned} card${f.cardsEarned === 1 ? "" : "s"} earned`, tier: f.cardsEarned >= 3 ? "strong" : "base" });
  }
  if (!perfect && f.graded >= 3 && f.accuracy >= 80) {
    out.push({ label: `${f.accuracy}% on the card`, tier: "strong" });
  }

  const rank: Record<BadgeTier, number> = { elite: 0, strong: 1, base: 2 };
  return out
    .map((b, i) => ({ b, i }))
    .sort((a, z) => rank[a.b.tier] - rank[z.b.tier] || a.i - z.i)
    .slice(0, limit)
    .map((x) => x.b);
}
