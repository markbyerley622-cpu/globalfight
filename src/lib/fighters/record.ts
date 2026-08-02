// ════════════════════════════════════════════════════════════════════════════
//  A fighter's headline record — derived, never assumed. PURE.
//
//  Rose Namajunas's profile showed 0-0-0 in a donut and three large zeros in a
//  W/L/D grid, directly above a fight history listing five of her bouts with
//  results. The page contradicted itself in a single viewport.
//
//  The cause is that the stored `wins`/`losses`/`draws` columns are an IMPORTED
//  record — filled by a provider that carries one — while the fight history is
//  built by a different pipeline. When the record import has not covered a
//  fighter the columns are still 0, and 0 is indistinguishable from "genuinely
//  undefeated and untested" once it reaches a numeric component. formatSportRecord
//  already knew this and returns "" for an all-zero record; the donut and the
//  stat grid took the raw numbers and rendered zeros.
//
//  ── Why "derived" is a state and not a silent substitution ────────────────
//
//  Counting the bouts we hold is NOT the same fact as an official record. We hold
//  a fighter's UFC bouts and not their amateur or regional career, so a derived
//  record is a floor, not a total. Presenting it as though it were official would
//  replace one wrong number with another. So the derivation is labelled, and the
//  UI says where the number came from.
//
//  Three states, and the third is the one that was missing:
//    stored   -> an imported record. Authoritative; shown plainly.
//    derived  -> counted from the settled bouts we hold. Shown, and labelled.
//    null     -> we have neither. Show NOTHING. Never 0-0-0.
// ════════════════════════════════════════════════════════════════════════════

import type { Fight } from "@/lib/types";
import { winningCorner } from "@/lib/event-format";

export interface ResolvedRecord {
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  /** Where the number came from. Drives whether the UI qualifies it. */
  source: "stored" | "derived";
  /** Settled bouts the derivation counted. 0 when `source` is "stored". */
  countedBouts: number;
}

/** True when a fighter identifier (id or slug) refers to this corner. */
function isCorner(corner: Fight["red"], key: string): boolean {
  return corner.id === key || corner.slug === key;
}

/**
 * Count a record from fight history.
 *
 * Only SETTLED bouts count, and only bouts whose outcome we can actually read:
 * a WIN whose `winnerId` identifies neither corner is skipped rather than
 * guessed, for the same reason /results must not credit a corner by position.
 * Cancelled bouts never count — a scratched fight is not a loss.
 */
export function recordFromHistory(
  fights: Fight[],
  fighterKey: string,
): { wins: number; losses: number; draws: number; noContests: number; counted: number } {
  let wins = 0, losses = 0, draws = 0, noContests = 0, counted = 0;
  for (const f of fights) {
    if (f.cancelled) continue;
    if (f.result === "SCHEDULED") continue;
    const isRed = isCorner(f.red, fighterKey);
    const isBlue = isCorner(f.blue, fighterKey);
    if (!isRed && !isBlue) continue; // not this fighter's bout

    if (f.result === "NO_CONTEST") { noContests++; counted++; continue; }
    if (f.result === "DRAW") { draws++; counted++; continue; }

    const corner = winningCorner(f);
    if (!corner) continue; // decided, but by whom is unrecorded — not a guess
    if ((corner === "red") === isRed) wins++;
    else losses++;
    counted++;
  }
  return { wins, losses, draws, noContests, counted };
}

/**
 * The record to display, or null when we do not have one.
 *
 * `null` is the important return. Rendering nothing is honest; rendering 0-0-0
 * asserts a fighter has never competed, which for an imported profile is almost
 * always false and — as the audit found — sat directly above the evidence that
 * it was false.
 */
export function resolveFighterRecord(
  stored: { wins: number; losses: number; draws: number; noContests?: number },
  fights: Fight[],
  fighterKey: string,
): ResolvedRecord | null {
  const storedNc = stored.noContests ?? 0;
  const hasStored = stored.wins > 0 || stored.losses > 0 || stored.draws > 0 || storedNc > 0;
  if (hasStored) {
    return {
      wins: stored.wins, losses: stored.losses, draws: stored.draws, noContests: storedNc,
      source: "stored", countedBouts: 0,
    };
  }

  const h = recordFromHistory(fights, fighterKey);
  if (h.counted === 0) return null;
  return {
    wins: h.wins, losses: h.losses, draws: h.draws, noContests: h.noContests,
    source: "derived", countedBouts: h.counted,
  };
}

/**
 * Records split by DISCIPLINE — never summed across them.
 *
 * A fighter's Muay Thai record and their MMA record are different facts. The
 * single headline record merges them, which for a crossover athlete produces a
 * number that describes nobody: Superlek's Muay Thai record says what he is,
 * and adding two kickboxing bouts to it says nothing at all.
 *
 * Grouped by the BOUT's ruleset, so it is the same authority the rest of the
 * platform uses. Bouts whose ruleset is UNKNOWN are gathered under `unknown`
 * rather than folded into a discipline they might not belong to — an honest
 * "3 bouts we cannot categorise" beats a wrong total.
 *
 * Ordered by bout count, so the discipline a fighter is most defined by leads.
 */
export interface DisciplineRecord {
  /** Ruleset enum value, e.g. "MUAY_THAI". */
  ruleset: string;
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  bouts: number;
}

export function recordsByDiscipline(
  fights: Fight[],
  fighterKey: string,
): { records: DisciplineRecord[]; unknown: number } {
  const byRuleset = new Map<string, DisciplineRecord>();
  let unknown = 0;

  for (const f of fights) {
    if (f.cancelled || f.result === "SCHEDULED") continue;
    const isRed = isCorner(f.red, fighterKey);
    const isBlue = isCorner(f.blue, fighterKey);
    if (!isRed && !isBlue) continue;

    const rs = f.ruleset && f.ruleset !== "UNKNOWN" ? f.ruleset : null;
    if (!rs) { unknown += 1; continue; }

    const rec = byRuleset.get(rs) ?? { ruleset: rs, wins: 0, losses: 0, draws: 0, noContests: 0, bouts: 0 };

    if (f.result === "NO_CONTEST") rec.noContests += 1;
    else if (f.result === "DRAW") rec.draws += 1;
    else {
      const corner = winningCorner(f);
      // Decided but unattributable — counted as a bout, credited to neither.
      if (!corner) { rec.bouts += 1; byRuleset.set(rs, rec); continue; }
      if ((corner === "red") === isRed) rec.wins += 1;
      else rec.losses += 1;
    }
    rec.bouts += 1;
    byRuleset.set(rs, rec);
  }

  return {
    records: [...byRuleset.values()].sort((a, b) => b.bouts - a.bouts || a.ruleset.localeCompare(b.ruleset)),
    unknown,
  };
}

/**
 * A streak is only meaningful on a record foundation we trust.
 *
 * The audit also found "1-fight skid" on the same profile whose record was
 * blank: the streak was computed from the handful of bouts we happened to hold,
 * with no way to know whether the fighter's most recent bout was among them. A
 * streak read off an incomplete, unordered history is a statement about our
 * ingest coverage, not about the fighter.
 *
 * So a streak needs two things: a record we are willing to state at all, and
 * enough settled bouts for "streak" to mean something. One bout is not a streak
 * — it is the only fight we happen to hold, and calling it a "1-fight skid"
 * dresses up a coverage gap as an analysis of the fighter.
 */
export const MIN_BOUTS_FOR_STREAK = 2;

export function canShowStreak(record: ResolvedRecord | null, settledBouts: number): boolean {
  return record !== null && settledBouts >= MIN_BOUTS_FOR_STREAK;
}
