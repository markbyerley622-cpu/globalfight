import type { FighterRank } from "@/lib/events-query";

// Event↔ranking intelligence. Pure so it's unit-testable and shared by the card
// and (later) the event page. Every claim is DERIVED from real rankings — never
// invented. When there's nothing true to say, it says nothing (returns null).

/**
 * One honest line for a bout, from the two corners' rankings:
 *  - both ranked → "Ranked matchup · #a vs #b · avg X"
 *  - a #1 involved → "Title implications" instead of "Ranked matchup"
 *  - fewer than two ranked fighters → null (the rank chips carry it alone)
 */
export function matchupIntel(a: FighterRank | null, b: FighterRank | null): string | null {
  if (!a || !b) return null;
  const label = Math.min(a.rank, b.rank) === 1 ? "Title implications" : "Ranked matchup";
  const avg = ((a.rank + b.rank) / 2).toFixed(1).replace(/\.0$/, "");
  return `${label} · #${a.rank} vs #${b.rank} · avg ${avg}`;
}
