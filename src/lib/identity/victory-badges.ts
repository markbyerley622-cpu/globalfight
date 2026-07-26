// Pure achievement-badge logic for the Prediction Victory Card. NO server-only,
// NO prisma — the deterministic core, unit-testable without a database (same
// split as scoring.ts / streak-math.ts / victory-headline.ts).
//
// A badge is the answer to "why was THIS call impressive?" — the deck's Status
// and Identity pillars made concrete. Every badge is an OBJECTIVELY TRUE,
// point-in-time fact about the pick or the user's standing; a fact we cannot
// prove from stored data is never a badge. The headline is the one hero line;
// badges are the supporting stack that makes difficulty and status legible in
// the three seconds someone looks at a shared card.

import { QUORUM, type CardFacts } from "@/lib/identity/victory-headline";

/** Visual weight tier — drives colour/emphasis, highest first. */
export type BadgeTier = "elite" | "strong" | "base";

export type BadgeKind =
  | "rarity" | "upset" | "crowd" | "streak" | "conviction" | "finish" | "title" | "elite" | "milestone";

export interface Badge {
  kind: BadgeKind;
  label: string;
  tier: BadgeTier;
}

export interface BadgeContext extends CardFacts {
  /** Whole-percent all-time accuracy, or null with no graded picks. */
  accuracy: number | null;
  /** Leaderboard percentile (1 = top), or null when unranked. */
  percentile: number | null;
  /** Best-ever pick streak — lets us detect a career-best run truthfully. */
  bestStreak: number;
  /** Reputation total AFTER this pick, and the exact delta it paid. */
  reputation: number;
  repGained: number;
  /** Crowd's mean confidence on this bout (0..5), or null if nobody set one. */
  consensusConfidence: number | null;
}

// The reputation lines worth announcing — kept in sync with reputation.ts's
// milestones so a card and a milestone notification never disagree.
const REP_MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10_000] as const;

const fmtK = (n: number): string => (n >= 1000 ? `${(n / 1000).toString().replace(/\.0$/, "")}k` : String(n));

const calledFinish = (f: CardFacts): boolean =>
  f.calledMethod !== null && f.resultMethod !== null && f.calledMethod === f.resultMethod;

/**
 * Every true badge for this pick, richest first, capped for display. Only wins
 * carry the achievement stack — a loss card stays honest and quiet (the headline
 * already tells that story; we do not decorate a miss).
 */
export function predictionBadges(c: BadgeContext, limit = 4): Badge[] {
  if (!c.correct) return [];
  const out: Badge[] = [];
  const hasQuorum = c.crowdTotal >= QUORUM;
  const beat = 100 - c.calledByPct;

  // ── Rarity of the call (contrarian correctness) ──
  if (hasQuorum && c.calledByPct <= 10) {
    out.push({ kind: "rarity", label: `Only ${c.calledByPct}% called it`, tier: "elite" });
  } else if (hasQuorum && c.calledByPct <= 33) {
    out.push({ kind: "upset", label: "Called the upset", tier: "elite" });
  }

  // ── Elite standing ──
  if (c.percentile !== null && c.percentile <= 5) {
    out.push({ kind: "elite", label: `Top ${c.percentile}% predictor`, tier: "elite" });
  } else if (c.percentile !== null && c.percentile <= 25) {
    out.push({ kind: "elite", label: `Top ${c.percentile}% of callers`, tier: "strong" });
  }

  // ── Reputation milestone crossed BY this pick (exact, from the delta) ──
  const before = c.reputation - c.repGained;
  const crossed = REP_MILESTONES.filter((m) => before < m && c.reputation >= m).pop();
  if (crossed) out.push({ kind: "milestone", label: `${fmtK(crossed)} reputation`, tier: "elite" });

  // ── Streak ──
  if (c.streak !== null && c.streak >= 3 && c.streak === c.bestStreak) {
    out.push({ kind: "streak", label: `Career-best ${c.streak} streak`, tier: "elite" });
  } else if (c.streak !== null && c.streak >= 3) {
    out.push({ kind: "streak", label: `${c.streak}-fight streak`, tier: "strong" });
  }

  // ── Beat the room ──
  if (hasQuorum && beat >= 60) {
    out.push({ kind: "crowd", label: `Beat ${beat}% of callers`, tier: "strong" });
  }

  // ── Backed it harder than consensus, and was right ──
  if (
    c.confidence !== null && c.confidence >= 4 &&
    c.consensusConfidence !== null && c.confidence >= c.consensusConfidence + 0.75
  ) {
    out.push({ kind: "conviction", label: "Higher conviction than the crowd", tier: "strong" });
  }

  // ── Called the finish (winner AND method) ──
  if (calledFinish(c) && (c.confidence ?? 0) >= 3) {
    out.push({ kind: "finish", label: "Called the finish", tier: "strong" });
  }

  // ── Stage ──
  if (c.titleFight) out.push({ kind: "title", label: "Title-fight call", tier: "base" });

  // Rank by tier, preserving insertion order within a tier (already richest-first).
  const rank: Record<BadgeTier, number> = { elite: 0, strong: 1, base: 2 };
  return out
    .map((b, i) => ({ b, i }))
    .sort((a, z) => rank[a.b.tier] - rank[z.b.tier] || a.i - z.i)
    .slice(0, limit)
    .map((x) => x.b);
}
