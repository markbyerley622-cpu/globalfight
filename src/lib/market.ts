import type { Odds } from "@/lib/types";

export interface MarketProb {
  redP: number; // 0..1, vig-removed consensus
  blueP: number;
  books: number;
}

/**
 * Consensus market-implied win probability from the licensed odds feed.
 *
 * Averages each book's implied probability, then normalises out the vig so the
 * two sides sum to 1. Returns null when no live lines are connected — the UI
 * shows an honest "awaiting lines" state rather than fabricating a number.
 */
export function marketProbability(odds: Odds[]): MarketProb | null {
  if (!odds.length) return null;
  const r = odds.reduce((s, o) => s + o.redImplied, 0) / odds.length;
  const b = odds.reduce((s, o) => s + o.blueImplied, 0) / odds.length;
  const total = r + b || 1;
  return { redP: r / total, blueP: b / total, books: odds.length };
}
