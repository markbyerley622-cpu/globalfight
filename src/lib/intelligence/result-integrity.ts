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
