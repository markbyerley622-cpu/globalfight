import { isTerminal } from "@/lib/intelligence/pick-status";
import type { ResultGroup, ResultPick } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Grouping settled picks by event — PURE, so it can be tested without a
//  database.
//
//  Split out of queries.ts deliberately. The interesting behaviour here is not
//  the SELECT; it is what happens to twelve picks from one card, where an
//  eventless bout goes, and whether a void fight counts against someone's
//  record. Those are the rules that would silently misreport a member's
//  accuracy, and they should be provable in a unit test rather than only
//  observable against a seeded Postgres.
// ════════════════════════════════════════════════════════════════════════════

/** One settled pick, already resolved by the query, ready to be grouped. */
export interface GroupableRow extends ResultPick {
  eventSlug: string | null;
  eventName: string | null;
  promotion: string | null;
  /** ISO of the EVENT (falls back to the fight's own date). */
  eventDate: string;
}

/**
 * Collapse rows into per-event groups, preserving INPUT ORDER.
 *
 * The caller has already sorted (newest event first), and this must not
 * re-sort: a second ordering rule here could disagree with the query's, and the
 * page would show groups in an order the "load more" boundary does not match.
 *
 * Grouping is by event slug, so a bout that arrives later in the list still
 * joins its own card rather than opening a duplicate group further down.
 */
export function groupResults(rows: GroupableRow[]): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();

  for (const r of rows) {
    // A fight with no event gets its own group keyed by the BOUT. Two eventless
    // fights must not collapse together under one nameless header.
    const key = r.eventSlug ?? `fight:${r.fightSlug}`;
    const existing = groups.get(key);

    const pick: ResultPick = {
      fightSlug: r.fightSlug,
      redName: r.redName,
      blueName: r.blueName,
      pickedName: r.pickedName,
      winnerName: r.winnerName,
      finish: r.finish,
      status: r.status,
      correct: r.correct,
      points: r.points,
      date: r.date,
    };

    if (existing) {
      existing.picks.push(pick);
      continue;
    }
    groups.set(key, {
      eventSlug: r.eventSlug,
      eventName: r.eventName ?? `${r.redName} vs ${r.blueName}`,
      promotion: r.promotion,
      date: r.eventDate,
      picks: [pick],
      correctCount: 0,
      gradedCount: 0,
    });
  }

  // Tallies count GRADED picks only. A void bout or a scratched fight is not a
  // miss, and folding them in would understate everyone's record — the group
  // header would read "1/4" for someone who went 1-for-2 with two no-contests.
  for (const g of groups.values()) {
    for (const p of g.picks) {
      if (!isTerminal(p.status) || p.correct === null) continue;
      g.gradedCount += 1;
      if (p.correct) g.correctCount += 1;
    }
  }

  return [...groups.values()];
}
