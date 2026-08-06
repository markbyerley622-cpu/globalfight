import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  DATA QUALITY — per-promotion coverage, in one table.
//
//  ── What this is for ─────────────────────────────────────────────────────
//  Every existing tool answers "did the pipeline RUN?" (cron-doctor) or "is a
//  provider reachable?" (provider-doctor). Neither answers the question that
//  actually matters: "is the DATA right?"
//
//  A cron can run daily, succeed, and still leave eight ONE events with no
//  bouts on them, because the source it reads does not publish them. That gap is
//  invisible to a green cron dashboard and shows up as a user complaint weeks
//  later. This is the report that surfaces it first.
//
//  ── Why it is grouped by PROMOTION ───────────────────────────────────────
//  Because coverage is not uniform and never will be. UFC has an official API,
//  ONE renders results client-side, BKFC publishes nothing machine-readable, and
//  each of those is a different piece of work. A single global "94% complete"
//  number hides exactly the information needed to decide what to build next.
//
//  ── Only the PAST is judged for results ──────────────────────────────────
//  An upcoming card having no winners is correct, not a gap. Counting it as one
//  would make the report cry wolf on every future event and nobody would read it
//  twice.
// ════════════════════════════════════════════════════════════════════════════

export type CoverageStatus = "healthy" | "warning" | "critical" | "empty";

export interface PromotionCoverage {
  promotion: string;
  /** Total events on record. */
  events: number;
  /** Events (any date) with no bouts attached at all. */
  missingBouts: number;
  /** PAST events that have bouts but no decided result on any of them. */
  missingResults: number;
  /** Past events with at least one bout carrying a result. */
  withResults: number;
  /** Does this promotion have a current titleholder on record? */
  hasChampions: boolean;
  /** Does it publish a ranking we ingest? */
  hasRankings: boolean;
  status: CoverageStatus;
  /** The single most useful sentence about this row. */
  note: string;
}

export interface DataQualityReport {
  generatedAt: string;
  promotions: PromotionCoverage[];
  totals: {
    events: number;
    missingBouts: number;
    missingResults: number;
    promotionsWithGaps: number;
  };
}

/**
 * A gap is only a gap once a card has had time to be reported.
 *
 * Results appear over hours, not instantly: a card that finished four hours ago
 * legitimately has no winners recorded yet, and flagging it would make every
 * morning's report open with a false alarm about last night's show.
 */
const RESULT_GRACE_HOURS = 36;

/** Below this many events, a promotion is too small for percentages to mean much. */
const SMALL_SAMPLE = 5;

export async function auditDataQuality(now = new Date()): Promise<DataQualityReport> {
  const resultCutoff = new Date(now.getTime() - RESULT_GRACE_HOURS * 3_600_000);

  // Four grouped queries for the whole report, whatever the number of
  // promotions. The naive version is a query per promotion per metric, which is
  // how a "quick report" becomes a two-minute page load.
  const [byPromotion, boutless, pastWithBouts, resolved, championOrgs, rankingOrgs] = await Promise.all([
    prisma.event.groupBy({ by: ["promotion"], _count: { _all: true } }),
    // No bouts at all — the card itself never landed.
    prisma.event.groupBy({
      by: ["promotion"],
      where: { fights: { none: {} } },
      _count: { _all: true },
    }),
    // Past cards that DO have bouts. The denominator for results coverage.
    prisma.event.groupBy({
      by: ["promotion"],
      where: { date: { lt: resultCutoff }, fights: { some: {} } },
      _count: { _all: true },
    }),
    // …of those, the ones where at least one bout has been decided.
    prisma.event.groupBy({
      by: ["promotion"],
      where: {
        date: { lt: resultCutoff },
        fights: { some: { result: { not: "SCHEDULED" } } },
      },
      _count: { _all: true },
    }),
    prisma.titleReign
      .findMany({ where: { endedAt: null }, select: { organisation: true }, distinct: ["organisation"] })
      .catch(() => [] as { organisation: string }[]),
    prisma.ranking
      .findMany({ where: { organisation: { not: "" } }, select: { organisation: true }, distinct: ["organisation"] })
      .catch(() => [] as { organisation: string }[]),
  ]);

  const count = (rows: { promotion: string | null; _count: { _all: number } }[], key: string | null) =>
    rows.find((r) => r.promotion === key)?._count._all ?? 0;

  // Case-insensitive, because Event.promotion is free text written by several
  // pipelines: "ONE Championship" and "ONE" must not be two rows in a report
  // whose whole job is to be scanned quickly.
  const champions = new Set(championOrgs.map((c) => c.organisation.toUpperCase()));
  const rankings = new Set(rankingOrgs.map((r) => r.organisation.toUpperCase()));
  const knows = (set: Set<string>, promotion: string) => {
    const key = promotion.toUpperCase();
    for (const entry of set) {
      if (entry === key || key.startsWith(entry) || entry.startsWith(key)) return true;
    }
    return false;
  };

  const promotions: PromotionCoverage[] = byPromotion
    // Unattributed events are a real gap, but a different one — they belong in
    // the promotion-resolution report, not here, where they would sit at the top
    // of every row count and drown the per-promotion signal.
    .filter((p) => p.promotion && p.promotion.trim() && p.promotion !== "Various")
    .map((p) => {
      const promotion = p.promotion as string;
      const events = p._count._all;
      const missingBouts = count(boutless, p.promotion);
      const pastCards = count(pastWithBouts, p.promotion);
      const withResults = count(resolved, p.promotion);
      const missingResults = Math.max(0, pastCards - withResults);

      const hasChampions = knows(champions, promotion);
      const hasRankings = knows(rankings, promotion);

      return {
        promotion,
        events,
        missingBouts,
        missingResults,
        withResults,
        hasChampions,
        hasRankings,
        ...verdict({ events, missingBouts, missingResults, pastCards }),
      };
    })
    .sort((a, b) => b.events - a.events);

  return {
    generatedAt: now.toISOString(),
    promotions,
    totals: {
      events: promotions.reduce((n, p) => n + p.events, 0),
      missingBouts: promotions.reduce((n, p) => n + p.missingBouts, 0),
      missingResults: promotions.reduce((n, p) => n + p.missingResults, 0),
      promotionsWithGaps: promotions.filter((p) => p.status === "warning" || p.status === "critical").length,
    },
  };
}

/**
 * Status from PROPORTIONS, not absolute counts.
 *
 * Eight missing cards out of 800 is noise; eight out of twelve is a broken
 * provider. Absolute thresholds would flag the large promotions constantly and
 * the small ones never — precisely backwards, since the small ones are the ones
 * with no official source.
 */
function verdict(input: {
  events: number;
  missingBouts: number;
  missingResults: number;
  pastCards: number;
}): { status: CoverageStatus; note: string } {
  const { events, missingBouts, missingResults, pastCards } = input;

  if (events === 0) return { status: "empty", note: "No events on record." };

  const boutGap = missingBouts / events;
  const resultGap = pastCards > 0 ? missingResults / pastCards : 0;

  if (missingBouts === events) {
    return { status: "critical", note: "Every event is an empty shell — no card source is wired." };
  }
  if (boutGap >= 0.25) {
    return { status: "critical", note: `${missingBouts} of ${events} events have no bouts.` };
  }
  if (resultGap >= 0.25 && pastCards >= SMALL_SAMPLE) {
    return { status: "critical", note: `${missingResults} of ${pastCards} finished cards have no result.` };
  }
  if (missingBouts > 0 || missingResults > 0) {
    return {
      status: "warning",
      note: [
        missingBouts > 0 ? `${missingBouts} without bouts` : null,
        missingResults > 0 ? `${missingResults} without results` : null,
      ].filter(Boolean).join(", "),
    };
  }
  return { status: "healthy", note: "Complete." };
}
