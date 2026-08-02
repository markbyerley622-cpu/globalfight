import type { FightResult } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════
//  Result integrity — the rule that keeps prediction resolution trustworthy:
//  a bout that has been DECIDED must never be silently un-decided by a later
//  sync. Prediction payouts, streaks, leaderboards and history all key off the
//  fight result; flipping a decided WIN back to SCHEDULED (because a schedule-
//  only provider ran, or a results provider briefly dropped the bout) would
//  make a completed fight look "unresolved" and desync the graded picks.
// ════════════════════════════════════════════════════════════════════════

/** A result other than SCHEDULED — an outcome a fan/prediction can rely on. */
export function isDecided(result: FightResult | null | undefined): boolean {
  return result != null && result !== "SCHEDULED";
}

/**
 * A decided WIN must name one of the bout's own two corners.
 *
 * Every importer resolves the winner by matching the source's winner id against
 * the source's red/blue ids. When a source is inconsistent — a renamed fighter,
 * a late corner swap, a parser reading the wrong column — that match fails and
 * the code path is left holding `result: "WIN"` with no `winnerId`. Written as-is
 * that is a bout the database says was won by nobody: the fighter's record can
 * never be derived from it, settlement has nothing to grade against, and every
 * surface has to invent a rule for what to show (which is how the corner-position
 * bug got in).
 *
 * So an unattributed win is not a win. Downgrade it to SCHEDULED and let the
 * harvester try again with a source that can name the winner, rather than
 * recording a fact we do not have.
 *
 * Returns the update unchanged when the result is attributable. Pure.
 */
export function requireAttributedWinner<T extends Record<string, unknown>>(
  update: T,
  corners: { redId: string; blueId: string },
): { update: T; rejected: boolean } {
  if (update.result !== "WIN") return { update, rejected: false };
  const w = update.winnerId;
  if (typeof w === "string" && (w === corners.redId || w === corners.blueId)) {
    return { update, rejected: false };
  }
  const next = { ...update };
  delete next.result;
  delete next.method;
  delete next.winnerId;
  delete next.roundEnded;
  return { update: next, rejected: true };
}

/**
 * Guard a Fight UPDATE against un-deciding a bout. If the stored result is
 * already decided and the incoming update would set it back to SCHEDULED, strip
 * the result and its dependent fields from the update — the decided outcome
 * stands. Corrections BETWEEN decided results (e.g. an overturned decision, or a
 * fixed wrong result) are still allowed; only the downgrade to SCHEDULED is
 * blocked. Pure and side-effect-free so it can front every write path.
 */
export function preventResultDowngrade<T extends Record<string, unknown>>(
  existingResult: FightResult,
  update: T,
): T {
  if (isDecided(existingResult) && update.result === "SCHEDULED") {
    const next = { ...update };
    delete next.result;
    delete next.method;
    delete next.winnerId;
    delete next.roundEnded;
    return next;
  }
  return update;
}
