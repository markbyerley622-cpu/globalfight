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
  awaitingSample: { slug: string; event: string; date: string }[];
  lagSample: { slug: string; event: string; date: string }[];
}

export async function resultOps(sampleSize = 20): Promise<ResultOps> {
  const overdue = new Date(Date.now() - RESULTS_GRACE_HOURS * 3_600_000);

  const [awaitingResults, resolutionLag, awaitingRows, lagRows] = await Promise.all([
    prisma.fight.count({ where: { result: "SCHEDULED", date: { lt: overdue } } }),
    prisma.fight.count({ where: { result: { not: "SCHEDULED" }, picksResolvedAt: null, picks: { some: {} } } }),
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
    awaitingSample: awaitingRows.map(toSample),
    lagSample: lagRows.map(toSample),
  };
}
