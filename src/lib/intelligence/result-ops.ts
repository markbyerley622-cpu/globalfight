import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════
//  Result operational visibility — makes "a completed fight must never remain
//  unresolved" OBSERVABLE. Two independent failure modes, each queryable:
//
//    • awaitingResults — the event is over but the bout is still SCHEDULED. The
//      results provider hasn't delivered an outcome (dead feed, slug mismatch,
//      missing coverage). This is the human review queue.
//    • resolutionLag  — the bout HAS a decided result but its picks were never
//      graded (a cron that never ran, or errored past this fight). Prediction
//      payouts are owed and not paid.
//
//  Both are cheap and indexed (Fight.@@index([date, result]) + picksResolvedAt).
// ════════════════════════════════════════════════════════════════════════

// Grace window after an event's start before an unresolved bout is "overdue":
// enough for the card to finish and the results source to publish.
const RESULTS_GRACE_HOURS = 12;

export interface ResultOps {
  awaitingResults: number;   // over, still SCHEDULED — needs a result
  resolutionLag: number;     // decided, but picks never graded
  /**
   * THE INVARIANT VIOLATION, counted directly: individual FightPick rows that are
   * ungraded while their bout has a DECISIVE result. `resolutionLag` counts fights;
   * this counts the actual owed payouts, and it is the number that must be zero.
   * A fight can be stamped resolved while a pick slipped through — that would show
   * here and nowhere else.
   */
  unsettledPicks: number;
  /** Open battles on a bout that already has a result. */
  unsettledBattles: number;
  awaitingSample: { slug: string; event: string; date: string }[];
  lagSample: { slug: string; event: string; date: string }[];
}

export async function resultOps(sampleSize = 20): Promise<ResultOps> {
  const overdue = new Date(Date.now() - RESULTS_GRACE_HOURS * 3_600_000);

  const [awaitingResults, resolutionLag, unsettledPicks, unsettledBattles, awaitingRows, lagRows] =
    await Promise.all([
    prisma.fight.count({ where: { result: "SCHEDULED", date: { lt: overdue } } }),
    prisma.fight.count({ where: { result: { not: "SCHEDULED" }, picksResolvedAt: null, picks: { some: {} } } }),
    // Decisive only: a draw / no-contest leaves picks ungraded BY DESIGN (there was
    // no winner to call), so counting those would report permanent phantom drift.
    prisma.fightPick.count({ where: { correct: null, fight: { result: "WIN" } } }),
    prisma.battle.count({
      where: { state: { in: ["WAITING", "ACTIVE"] }, fight: { result: { not: "SCHEDULED" } } },
    }),
    prisma.fight.findMany({
      where: { result: "SCHEDULED", date: { lt: overdue } },
      orderBy: { date: "desc" },
      take: sampleSize,
      select: { slug: true, date: true, event: { select: { name: true } } },
    }),
    prisma.fight.findMany({
      where: { result: { not: "SCHEDULED" }, picksResolvedAt: null, picks: { some: {} } },
      orderBy: { date: "asc" },
      take: sampleSize,
      select: { slug: true, date: true, event: { select: { name: true } } },
    }),
  ]);

  const toSample = (r: { slug: string; date: Date; event: { name: string } | null }) => ({
    slug: r.slug,
    event: r.event?.name ?? "—",
    date: r.date.toISOString(),
  });

  return {
    awaitingResults,
    resolutionLag,
    unsettledPicks,
    unsettledBattles,
    awaitingSample: awaitingRows.map(toSample),
    lagSample: lagRows.map(toSample),
  };
}
