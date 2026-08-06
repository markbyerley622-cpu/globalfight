import "server-only";
import type { Prisma } from "@prisma/client";
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
  /**
   * Gap events the EXISTING Wikipedia backfill would already pick up.
   *
   * The most important column in this report, and the reason it exists: it
   * separates "we have no source for this" from "we have a source and it has not
   * run". Those look identical in a gap count and lead to completely different
   * sprints — one is eight new connectors, the other is a cron service.
   *
   * Matches findWikiTargets' own predicate (a past, non-cancelled event with
   * `resultsCompleteAt: null` that either has no bouts or has an undecided one),
   * so this is what that job would actually queue, not an estimate of it.
   */
  reachableByBackfill: number;
  /** FUTURE events with no card yet — a different problem to a historical gap. */
  upcomingMissingCard: number;
  /** Does this promotion have a current titleholder on record? */
  hasChampions: boolean;
  /** Does it publish a ranking we ingest? */
  hasRankings: boolean;
  status: CoverageStatus;
  /** The single most useful sentence about this row. */
  note: string;
}

/** Freshness of the machinery, as opposed to completeness of the data. */
export interface PipelineHealth {
  /** Ranking rows whose reconciliation is older than the staleness ceiling. */
  staleRankings: number;
  /** Most recent open-reign update, i.e. how fresh champion data is. */
  championsUpdatedAt: string | null;
  /** Open "is this the same person?" questions awaiting review. */
  duplicateCandidates: number;
  /** Per-provider sync state, worst first. */
  providers: ProviderFreshness[];
}

export interface ProviderFreshness {
  provider: string;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  failureStreak: number;
  lastError: string | null;
}

export interface DataQualityReport {
  generatedAt: string;
  promotions: PromotionCoverage[];
  health: PipelineHealth;
  totals: {
    events: number;
    missingBouts: number;
    missingResults: number;
    reachableByBackfill: number;
    promotionsWithGaps: number;
  };
}

/** A ranking not reconciled within this many days is stale. */
const RANKING_STALE_DAYS = 14;

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
  // The EXISTING Wikipedia backfill's own eligibility predicate, mirrored so the
  // "reachable" column reports what that job would actually queue rather than an
  // approximation of it. See lib/scraper/wikicard/targets::findWikiTargets.
  const backfillEligible: Prisma.EventWhereInput = {
    date: { lt: now },
    status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
    resultsCompleteAt: null,
    OR: [{ fights: { none: {} } }, { fights: { some: { result: "SCHEDULED" } } }],
  };

  const [
    byPromotion, boutless, pastWithBouts, resolved, championOrgs, rankingOrgs,
    reachable, upcomingBoutless, pastEvents,
  ] = await Promise.all([
    prisma.event.groupBy({ by: ["promotion"], _count: { _all: true } }),
    // ── PAST events with no bouts. The card happened and never landed. ─────
    //
    // `date: { lt: now }` is load-bearing and was missing in the first version.
    // Without it a promotion that had simply ANNOUNCED a season of future events
    // was reported as critical: the IJF showed "61 of 117 events have no bouts"
    // when all 61 were upcoming, and Real American Freestyle was reported as
    // "every event is an empty shell — no card source is wired" when all five of
    // its events are in the future and nobody has published a card yet.
    //
    // Two false criticals on a report whose entire job is to tell you where to
    // spend a sprint. Future events with no card are a real thing to track, and
    // they have their own column (`upcomingMissingCard`) precisely so they are
    // not confused with a source that is broken.
    prisma.event.groupBy({
      by: ["promotion"],
      where: { date: { lt: now }, fights: { none: {} } },
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
    prisma.event.groupBy({ by: ["promotion"], where: backfillEligible, _count: { _all: true } }),
    prisma.event.groupBy({
      by: ["promotion"],
      where: { date: { gte: now }, fights: { none: {} } },
      _count: { _all: true },
    }),
    // The denominator for the bout gap. Judging "251 of 509" against ALL events
    // understates a promotion whose back catalogue is broken and overstates one
    // that has merely announced a lot of future cards.
    prisma.event.groupBy({ by: ["promotion"], where: { date: { lt: now } }, _count: { _all: true } }),
  ]);

  type Grouped = { promotion: string | null; _count: { _all: number } };
  const count = (rows: readonly unknown[], key: string | null) =>
    (rows as Grouped[]).find((r) => r.promotion === key)?._count._all ?? 0;

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
        reachableByBackfill: count(reachable, p.promotion),
        upcomingMissingCard: count(upcomingBoutless, p.promotion),
        hasChampions,
        hasRankings,
        ...verdict({ events, past: count(pastEvents, p.promotion), missingBouts, missingResults, pastCards }),
      };
    })
    // WORST FIRST, not biggest first. A report sorted by size puts the healthy
    // giants at the top and buries the broken small promotion at the bottom,
    // which is the opposite of what someone opens it to find out.
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.missingBouts + b.missingResults - (a.missingBouts + a.missingResults));

  return {
    generatedAt: now.toISOString(),
    promotions,
    health: await auditPipelineHealth(now),
    totals: {
      events: promotions.reduce((n, p) => n + p.events, 0),
      missingBouts: promotions.reduce((n, p) => n + p.missingBouts, 0),
      missingResults: promotions.reduce((n, p) => n + p.missingResults, 0),
      reachableByBackfill: promotions.reduce((n, p) => n + p.reachableByBackfill, 0),
      promotionsWithGaps: promotions.filter((p) => p.status === "warning" || p.status === "critical").length,
    },
  };
}

const SEVERITY: Record<CoverageStatus, number> = { critical: 0, warning: 1, empty: 2, healthy: 3 };

/**
 * Freshness of the machinery.
 *
 * Separate from coverage because they fail independently and are fixed by
 * different people: a promotion can have complete data while its provider has
 * been dark for a month (nothing new has happened), and it can have a perfectly
 * healthy provider while its data is full of holes (the source does not publish
 * them). Merging the two into one "health" number loses both.
 */
async function auditPipelineHealth(now: Date): Promise<PipelineHealth> {
  const staleBefore = new Date(now.getTime() - RANKING_STALE_DAYS * 86_400_000);

  const [staleRankings, freshestReign, duplicateCandidates, checkpoints] = await Promise.all([
    prisma.ranking
      .count({ where: { OR: [{ reconciledAt: null }, { reconciledAt: { lt: staleBefore } }] } })
      .catch(() => 0),
    prisma.titleReign
      .findFirst({ where: { endedAt: null }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
      .catch(() => null),
    prisma.fighterIdentityCandidate.count({ where: { status: "PENDING" } }).catch(() => 0),
    prisma.providerCheckpoint
      .findMany({ orderBy: [{ failureStreak: "desc" }, { lastCheckedAt: "asc" }], take: 30 })
      .catch(() => []),
  ]);

  return {
    staleRankings,
    championsUpdatedAt: freshestReign?.updatedAt.toISOString() ?? null,
    duplicateCandidates,
    providers: checkpoints.map((c) => ({
      provider: c.scope ? `${c.provider}/${c.scope}` : c.provider,
      lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      lastChangedAt: c.lastChangedAt?.toISOString() ?? null,
      failureStreak: c.failureStreak,
      lastError: c.lastError,
    })),
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
  /** Events that have already happened — the only ones judged for coverage. */
  past: number;
  missingBouts: number;
  missingResults: number;
  pastCards: number;
}): { status: CoverageStatus; note: string } {
  const { events, past, missingBouts, missingResults, pastCards } = input;

  if (events === 0) return { status: "empty", note: "No events on record." };
  // Everything on record is still to come. Not a gap — nobody has published a
  // card for a fight that has not happened yet.
  if (past === 0) {
    return { status: "healthy", note: `${events} upcoming event(s), none past — nothing to judge yet.` };
  }

  const boutGap = missingBouts / past;
  const resultGap = pastCards > 0 ? missingResults / pastCards : 0;

  if (missingBouts === past) {
    return { status: "critical", note: `All ${past} past events are empty shells — no card source is wired.` };
  }
  if (boutGap >= 0.25) {
    return { status: "critical", note: `${missingBouts} of ${past} past events have no bouts.` };
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
