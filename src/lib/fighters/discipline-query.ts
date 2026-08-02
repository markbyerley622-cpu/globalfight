import type { Prisma } from "@prisma/client";
import type { Sport } from "@/lib/types";

// ════════════════════════════════════════════════════════════════════════════
//  "Which fighters compete in X?" — ONE predicate, for every caller.
//
//  This exists so the cutover from Fighter.sport to Fighter.sports[] cannot
//  half-happen. The failure mode the migration has to avoid is not a bug in any
//  one query; it is the directory answering one way and search answering
//  another, forever, because each was migrated separately and one was missed.
//
//  Every consumer — directory, search, rankings, champions, communities,
//  recommendations — imports the fragment from here. Nothing writes
//  `{ sport: X }` against Fighter again.
//
//  ── WHY sports[] AND NOT sport ────────────────────────────────────────────
//
//  `sport` is a single imported label. `sports[]` is the set of disciplines the
//  fighter has VERIFIED bout evidence for, computed once by DisciplineResolver
//  and persisted. The difference is 1,309 Muay Thai fighters instead of 10, and
//  147 crossover athletes who appear correctly in more than one directory
//  rather than being forced into whichever one an importer guessed first.
//
//  Backed by a GIN index on Fighter.sports, so `has` is a lookup rather than a
//  scan over 10k rows.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fighters who compete in `sport` — the DIRECTORY predicate.
 *
 * Inclusive by design: a fighter appears under every discipline they have
 * evidence for, and LOW-confidence fighters are included. Someone whose only
 * evidence is an import label still belongs in a browsable list; the UI shows
 * the confidence rather than hiding them. Rankings apply a stricter bar — see
 * `rankableInDiscipline`.
 *
 * An absent sport means "no filter", so callers can pass through a URL param
 * without branching.
 */
export function competesInDiscipline(sport?: Sport | string | null): Prisma.FighterWhereInput {
  if (!sport) return {};
  return { sports: { has: sport as Sport } };
}

/**
 * Tiers a fighter must reach to be RANKED in a discipline.
 *
 * HIGH  — the source stated the ruleset on their bouts.
 * MEDIUM— derived from a single-ruleset promotion or the card's sport.
 *
 * LOW is excluded: it means the only evidence is a provider's import label, and
 * ranking someone on a label alone is exactly what the generated boxing P4P was
 * doing when it listed four surname-only stubs with zero bouts.
 */
export const RANKABLE_TIERS = ["HIGH", "MEDIUM"] as const;

/**
 * Fighters eligible to be RANKED in `sport` — verified evidence only.
 *
 * The stricter sibling of `competesInDiscipline`. Use for rankings, champions
 * and anything that presents an ordering as authoritative; use the inclusive
 * one for browsing.
 */
export function rankableInDiscipline(sport?: Sport | string | null): Prisma.FighterWhereInput {
  return {
    ...competesInDiscipline(sport),
    disciplineTier: { in: [...RANKABLE_TIERS] },
  };
}

/**
 * Nested form, for a query filtering by a RELATED fighter
 * (`Ranking.fighter`, `Fight.red`, …). Same rule, so a nested filter can never
 * drift from the top-level one.
 */
export function fighterCompetesIn(sport?: Sport | string | null): { fighter: Prisma.FighterWhereInput } | Record<string, never> {
  if (!sport) return {};
  return { fighter: competesInDiscipline(sport) };
}
