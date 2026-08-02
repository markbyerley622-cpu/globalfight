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

// ════════════════════════════════════════════════════════════════════════════
//  THE WINNER INVARIANT. One definition, asserted immediately before every write.
//
//  At the moment a Fight row is committed, exactly one of these is true:
//      winnerId === redId
//      winnerId === blueId
//      winnerId === null
//  Nothing else is ever legal.
//
//  ── WHY AN ASSERTION AND NOT JUST A VALIDATOR ─────────────────────────────
//
//  requireAttributedWinner already validated the winner — against the INCOMING
//  corners. persist then discarded those corners (an existing bout must never be
//  re-seated: FightPick stores "RED"/"BLUE", so swapping corners inverts every
//  pick on the bout) and kept the STORED ones. Validation and persistence were
//  looking at two different pairs.
//
//  Eight rows in production data reached the impossible state that way, all via
//  the slug fallback, where a bout matches by NAME while its fighter rows differ:
//      red "Soe Htet Oo"            winner "Soe Lin Oo"
//      red "Pentor SP Kansard…"     winner "Pentor SP.Kansart…"
//      red "Fritz Aldin Biagtan"    winner "Fritz Biagtan"
//
//  A validator can be called at the wrong moment. An assertion placed at the
//  write itself cannot: whatever a future code path does to the data on the way
//  down, it is checked against the exact values being committed. That is the
//  difference between fixing this bug and eliminating the class.
// ════════════════════════════════════════════════════════════════════════════

/** Thrown when a write would commit a winner who is not on the bout. */
export class WinnerInvariantError extends Error {
  constructor(readonly detail: { winnerId: string; redId: string; blueId: string; context: string }) {
    super(
      `Winner invariant violated (${detail.context}): winnerId=${detail.winnerId} ` +
        `is neither redId=${detail.redId} nor blueId=${detail.blueId}`,
    );
    this.name = "WinnerInvariantError";
  }
}

/**
 * The last line of defence. Call with the EXACT values about to be written.
 *
 * Throws rather than repairing: by this point the data has already passed the
 * places that could have corrected it, so a violation is a logic error in the
 * pipeline and must not be papered over. Inside persist it aborts a single
 * bout's transaction, so one bad row can never be committed and the rest of the
 * card still lands.
 */
export function assertWinnerMatchesCorners(
  winnerId: string | null | undefined,
  redId: string,
  blueId: string,
  context: string,
): void {
  if (!winnerId) return;
  if (winnerId === redId || winnerId === blueId) return;
  throw new WinnerInvariantError({ winnerId, redId, blueId, context });
}

/**
 * Resolve the winner against the corners that will ACTUALLY be stored.
 *
 * `candidate` is the winner as the provider's own corner resolution produced it.
 * When the bout already exists its stored corners win, and the candidate may
 * name a fighter row that is not on it — a near-duplicate created by a naming
 * difference the deduper did not catch.
 *
 * Returns null in that case rather than trying to map across. Mapping would mean
 * deciding that "Soe Lin Oo" and "Soe Htet Oo" are the same person, which is
 * exactly the guess that corrupts a result. A dropped winner is recoverable by a
 * later ingest; a wrong one silently rewrites a fighter's record.
 */
export function resolveWinnerForCorners(
  candidate: string | null | undefined,
  redId: string,
  blueId: string,
): { winnerId: string | null; unmatched: boolean } {
  if (!candidate) return { winnerId: null, unmatched: false };
  if (candidate === redId || candidate === blueId) return { winnerId: candidate, unmatched: false };
  return { winnerId: null, unmatched: true };
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
 * A stated ruleset must not be replaced by a weaker one.
 *
 * Fight.ruleset is the authority for fighter discipline, and the sources that
 * can state it are unevenly distributed: Wikipedia names it per bout
 * ("Featherweight Muay Thai", confidence 1), a single-ruleset promotion implies
 * it (0.8), and most providers cannot supply it at all. Those providers run on
 * the same cron and touch the same rows, so without this the LAST writer wins
 * and a re-ingest silently downgrades a known Muay Thai bout to UNKNOWN.
 *
 * Rules, in order:
 *   • an incoming UNKNOWN never overwrites a known ruleset;
 *   • a lower-confidence source never overwrites a higher-confidence one;
 *   • equal confidence DOES overwrite, so a corrected value from the same class
 *     of source can still land.
 *
 * Pure. Returns the update with the ruleset fields stripped when they must not
 * be applied.
 */
export function preventRulesetDowngrade<T extends Record<string, unknown>>(
  existing: { ruleset?: string | null; rulesetConfidence?: number | null },
  update: T,
): T {
  if (!("ruleset" in update)) return update;

  const known = existing.ruleset && existing.ruleset !== "UNKNOWN";
  if (!known) return update; // nothing to protect

  const incoming = update.ruleset;
  const incomingConf = typeof update.rulesetConfidence === "number" ? update.rulesetConfidence : 0;
  const existingConf = existing.rulesetConfidence ?? 0;

  const weaker = incoming === "UNKNOWN" || incomingConf < existingConf;
  if (!weaker) return update;

  const next = { ...update };
  delete next.ruleset;
  delete next.rulesetConfidence;
  delete next.rulesetSource;
  delete next.rulesetUpdatedAt;
  return next;
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
