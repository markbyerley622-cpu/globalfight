import "server-only";
import { prisma } from "@/lib/db";
import { log } from "../logger";
import { resolvePromotion } from "@/lib/promotions";
import { candidate, type ResolvedEntity } from "@/lib/entities/resolve";
import { buildSearchLadder } from "./search-strategies";
import { STATIC_IMPORT_SOURCES } from "../source-policy";
import type { Sport } from "@/lib/types";
import type { WikiTarget } from "./types";
import type { ExpectedBout } from "./verify";

// ════════════════════════════════════════════════════════════════════════════
//  Which past events still need something from Wikipedia — and what to search for.
//
//  This used to be `{ fights: { none: {} } }` — events with NO bouts at all — and
//  that single clause is why completed cards sat on "Result pending" forever. A
//  boxing or MMA event is created DAYS AHEAD with its full card, so it HAS fights,
//  so it never matched, so the only source carrying bout winners never looked at it
//  again.
//
//  There are TWO kinds of gap:
//    MISSING_CARD   — a past event with no bouts at all.
//    MISSING_RESULT — a past event whose bouts exist but carry no outcome.
//
//  And THREE modes, because a 12-hour lag and a 1,754-bout historical debt are not
//  the same problem and cannot share one hard-coded window:
//    incremental — the recent window; what the hourly cron runs.
//    historical  — every unresolved bout, however old; the repair pass.
//    replay      — one named event or promotion; targeted re-attempt.
//
//  Each target carries its bouts resolved to REGISTRY ENTITIES, because those are
//  what a candidate page is verified against (verify.ts) and what the alias search
//  strategies are built from. Resolution costs one extra query per batch.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Default look-back for the INCREMENTAL mode. A result older than this is
 * historical debt, not lag — chase it with mode "historical" rather than paying for
 * it on every hourly tick.
 */
export const RESULT_BACKFILL_DAYS = Number(process.env.RESULTS_BACKFILL_WINDOW_DAYS ?? 21);

/**
 * How far back a run looks, by cadence.
 *
 * The point is that the frequent job must not scan history. An event that ended
 * three years ago cannot acquire a result between 09:00 and 10:00, so paying for
 * it every hour buys nothing; a card that ended last night can and does. So the
 * hourly tick works a week, the daily sweep catches whatever the week missed, and
 * the deep pass is unbounded and rare.
 *
 *   recent — hourly. Last 7 days.
 *   daily  — once a day. Last 90 days; catches anything the hourly tier missed
 *            while a source was down or a page had not been written yet.
 *   deep   — weekly/manual. No bound at all: the historical reconciliation.
 */
export const RESULT_TIERS = {
  recent: 7,
  daily: 90,
  deep: null,
} as const;

export type ResultTier = keyof typeof RESULT_TIERS;

export const isResultTier = (v: unknown): v is ResultTier =>
  typeof v === "string" && v in RESULT_TIERS;

export type WikiGap = "missing_card" | "missing_result";
export type WikiMode = "incremental" | "historical" | "replay";

export interface FindTargetsOpts {
  limit?: number;
  /** Case-insensitive promotion or event-name filter (replay mode). */
  promotion?: string;
  /** Restrict to one gap kind. Default: both, results first. */
  gap?: WikiGap;
  /**
   * incremental (default) bounds the result gap to `windowDays`; historical removes
   * the bound entirely; replay is historical + a filter.
   */
  mode?: WikiMode;
  /** Overrides RESULT_BACKFILL_DAYS. Ignored in historical/replay mode. */
  windowDays?: number;
  /**
   * Cadence tier (see RESULT_TIERS). Sets the look-back window, and `deep` lifts
   * the bound entirely. Takes precedence over windowDays; ignored in
   * historical/replay mode, which are already unbounded.
   */
  tier?: ResultTier;
  /**
   * Skip the first N events of the result gap — lets a historical repair walk a
   * backlog larger than one batch without re-attempting the same head every run.
   */
  skip?: number;
  now?: Date;
}

interface EventRow {
  id: string;
  name: string;
  date: Date;
  sport: string;
  promotion: string | null;
}

/**
 * Past events that need a card or a result, RESULTS FIRST.
 *
 * The ordering is the point. A card that ended eight hours ago and shows "Result
 * pending" to every visitor is worth more than a 2019 event with no bouts, so it gets
 * the batch first. Card backfill takes whatever budget is left.
 */
export async function findWikiTargets(opts: FindTargetsOpts = {}): Promise<WikiTarget[]> {
  const limit = Math.max(1, opts.limit ?? 25);
  const skip = Math.max(0, opts.skip ?? 0);
  const now = opts.now ?? new Date();
  const mode: WikiMode = opts.mode ?? "incremental";
  const filter = opts.promotion
    ? {
        OR: [
          { promotion: { contains: opts.promotion, mode: "insensitive" as const } },
          { name: { contains: opts.promotion, mode: "insensitive" as const } },
        ],
      }
    : {};

  // Only the incremental mode is time-bounded. Historical repair must be able to
  // reach a bout from any date, or the backlog it exists to clear stays unreachable.
  //
  // Within incremental, the TIER decides how far back — `deep` is unbounded even
  // here, which is what lets one scheduled route serve all three cadences.
  const tierDays = opts.tier ? RESULT_TIERS[opts.tier] : undefined;
  const windowed = mode === "incremental" && tierDays !== null;
  const lookBack = tierDays ?? opts.windowDays ?? RESULT_BACKFILL_DAYS;
  const since = new Date(now.getTime() - lookBack * 86_400_000);

  // ── Never re-queue what cannot change ─────────────────────────────────────
  //
  // Two clauses, and they answer two different questions:
  //
  //  resultsCompleteAt — "is there anything left to learn about this card?" A card
  //    whose every bout is decided is done, whoever wrote it.
  //
  //  externalIds/source — "can THIS SOURCE ever say more than it already did?"
  //    A Wikipedia tournament bracket is imported whole and finished; it is also
  //    unreadable to the wikicard extractor, which has no results table to find.
  //    So its undecided bouts (walkovers, withdrawals) came back no_card on every
  //    single hourly tick. ~30 events were doing that. See lib/scraper/source-policy.
  const revisitable = {
    resultsCompleteAt: null,
    ...(STATIC_IMPORT_SOURCES.length
      ? { NOT: { externalIds: { some: { source: { in: STATIC_IMPORT_SOURCES } } } } }
      : {}),
  };

  const select = { id: true, name: true, date: true, sport: true, promotion: true } as const;
  const rows: { row: EventRow; gap: WikiGap }[] = [];

  // ── Gap 1: the card happened, the bouts are there, no outcome was ever ingested.
  // `some: { result: "SCHEDULED" }` is the clause that makes an event WITH a card
  // visible to the only source that carries winners.
  if (opts.gap !== "missing_card") {
    const found = await prisma.event.findMany({
      where: {
        date: windowed ? { gte: since, lt: now } : { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { some: { result: "SCHEDULED" } },
        ...revisitable,
        ...filter,
      },
      // LEAST-RECENTLY-ATTEMPTED FIRST — a rotation, not a leaderboard.
      //
      // This was `orderBy: { date: "desc" }`, which is why "some events resolve and
      // some stay Pending forever" was the observed behaviour. The hourly job takes
      // `limit` (RESULT_BATCH, 12) events from a 21-day window. Ordered by date
      // descending, that is the 12 NEWEST — so with 13+ unresolved events in the
      // window the same head was re-attempted every hour and the tail was never
      // attempted ONCE, then aged past 21 days and became unreachable to the
      // incremental mode entirely. Nothing was broken about the scraper, the parser
      // or the matching: which events got a result was decided by queue position.
      //
      // nulls-first means a never-attempted event always outranks one we have already
      // tried, so a new card is picked up promptly AND the backlog drains.
      //
      // `resultAttemptAt` DOMINATES on purpose, and coverage only breaks ties. Ranking
      // strictly by coverage — "finish the nearly-complete cards first" — reads well
      // and reintroduces exactly the starvation this ordering exists to prevent: a
      // 0%-coverage event would sit behind every partial one indefinitely. Rotation is
      // the invariant; nothing may outrank it. Ties are rare (millisecond timestamps),
      // so in practice this is a pure rotation with a sensible ordering inside a batch.
      orderBy: [
        { resultAttemptAt: { sort: "asc", nulls: "first" } },
        { resultCoverage: { sort: "desc", nulls: "last" } },
        { date: "desc" },
      ],
      skip,
      take: limit,
      select,
    });
    for (const row of found) rows.push({ row, gap: "missing_result" });
  }

  // ── Gap 2: no card at all. Always unbounded in time — a page may appear years
  // later, and a card is worth backfilling whenever we can get it.
  if (opts.gap !== "missing_result" && rows.length < limit) {
    const found = await prisma.event.findMany({
      where: {
        date: { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { none: {} },
        // A static-import event with no card is not a card we can fetch; it is a
        // card that source never had. `resultsCompleteAt` is always null here (no
        // bouts means never complete), so only the source clause does work.
        ...revisitable,
        ...filter,
      },
      // LEAST-RECENTLY-ATTEMPTED FIRST — the same rotation the result queue got,
      // for the same reason. Ordered by `date: "desc"` this queue handed back the
      // NEWEST 25 empty cards on every single call, and `recordResultAttempts`
      // (which the card path does write) changed nothing because no clause read
      // it. So a 97-event backlog re-attempted its head forever and 72 of those
      // events were still "never attempted" after every historical run we have
      // ever done — the audit's `never attempted` count was the symptom.
      //
      // nulls-first keeps a brand-new empty card ahead of one already tried, so
      // adding an event does not go to the back of a queue that never rotated.
      orderBy: [
        { resultAttemptAt: { sort: "asc", nulls: "first" } },
        { date: "desc" },
      ],
      skip,
      take: limit - rows.length,
      select,
    });
    for (const row of found) rows.push({ row, gap: "missing_card" });
  }

  if (!rows.length) return [];
  return buildTargets(rows);
}

/**
 * Turn event rows into targets: resolve each card's unresolved bouts to registry
 * entities (two batched queries for the whole set), then build the search ladder.
 */
async function buildTargets(rows: { row: EventRow; gap: WikiGap }[]): Promise<WikiTarget[]> {
  const eventIds = rows.map((r) => r.row.id);

  // The unresolved bouts on these cards, newest-first within each event so the
  // headline bout leads the ladder.
  const fights = await prisma.fight.findMany({
    where: { eventId: { in: eventIds }, result: "SCHEDULED" },
    orderBy: [{ mainEvent: "desc" }, { coMain: "desc" }, { orderOnCard: "asc" }],
    select: {
      eventId: true,
      red: { select: { id: true, slug: true, name: true, nickname: true } },
      blue: { select: { id: true, slug: true, name: true, nickname: true } },
    },
  });

  // Registry aliases for every corner involved — one query. This is what makes the
  // alias search strategy and alias-tolerant verification possible.
  const fighterIds = [...new Set(fights.flatMap((f) => [f.red.id, f.blue.id]))];
  const aliasRows = fighterIds.length
    ? await prisma.fighterAlias
        .findMany({ where: { fighterId: { in: fighterIds } }, select: { fighterId: true, alias: true } })
        .catch(() => [] as { fighterId: string; alias: string }[])
    : [];
  const aliases = new Map<string, string[]>();
  for (const a of aliasRows) aliases.set(a.fighterId, [...(aliases.get(a.fighterId) ?? []), a.alias]);

  const entity = (f: { id: string; slug: string; name: string; nickname: string | null }): ResolvedEntity =>
    candidate("fighter", {
      id: f.id,
      slug: f.slug,
      name: f.name,
      nickname: f.nickname,
      aliases: aliases.get(f.id) ?? [],
    });

  const boutsByEvent = new Map<string, ExpectedBout[]>();
  for (const f of fights) {
    if (!f.eventId) continue;
    const list = boutsByEvent.get(f.eventId) ?? [];
    list.push({ red: entity(f.red), blue: entity(f.blue) });
    boutsByEvent.set(f.eventId, list);
  }

  const targets: WikiTarget[] = [];
  for (const { row, gap } of rows) {
    const bouts = boutsByEvent.get(row.id) ?? [];
    const promo = resolvePromotion(row.promotion);
    // Only a CANONICAL promotion counts; "Various" is a placeholder, not an
    // organisation, and neither searching for it nor scoring on it means anything.
    const isReal = promo.slug !== "combat";
    const promotionName = isReal ? promo.name : null;
    const promotionAliases = isReal ? promo.aliases : [];

    const searchIdentity = buildSearchLadder({ eventName: row.name, promotionName, bouts });
    // A synthetic card with no bouts has no findable identity at all — its own name
    // cannot be searched and there is no bout to search for. Emitting it would spend
    // a request to learn nothing.
    if (!searchIdentity.length) continue;

    targets.push({
      eventId: row.id,
      eventIdentity: { name: row.name, date: row.date.toISOString(), sport: row.sport as Sport },
      searchIdentity,
      expectedBouts: bouts,
      gap,
      promotionName,
      promotionAliases,
    });
  }
  return targets;
}

/**
 * The target for ONE named bout — the `--fight "X vs Y" --explain` entry point.
 *
 * Same target-building path as a normal run, so what it traces is what a real run
 * would do. Matches on either fighter's name, newest first.
 */
export async function findWikiTargetForFight(query: string): Promise<WikiTarget | null> {
  const fight = await prisma.fight.findFirst({
    where: {
      result: "SCHEDULED",
      OR: [
        { slug: { contains: slugish(query), mode: "insensitive" } },
        { red: { name: { contains: firstName(query), mode: "insensitive" } } },
        { blue: { name: { contains: lastName(query), mode: "insensitive" } } },
      ],
    },
    orderBy: { date: "desc" },
    select: { eventId: true },
  });
  if (!fight?.eventId) return null;

  const ev = await prisma.event.findUnique({
    where: { id: fight.eventId },
    select: { id: true, name: true, date: true, sport: true, promotion: true },
  });
  if (!ev) return null;
  const built = await buildTargets([{ row: ev as EventRow, gap: "missing_result" }]);
  return built[0] ?? null;
}

const slugish = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const firstName = (q: string) => q.split(/\s+vs\.?\s+/i)[0]?.trim() ?? q;
const lastName = (q: string) => q.split(/\s+vs\.?\s+/i)[1]?.trim() ?? q;

/**
 * Record what happened to each attempted event.
 *
 * This is the other half of the starvation fix. Two things depend on it:
 *
 *   • the queue rotation in findWikiTargets — without a written `resultAttemptAt`
 *     the ordering has nothing to sort by and every run picks the same head again;
 *   • diagnosis — the harvester computes an exact per-event reason
 *     ("no_candidate", "all_rejected", "unverified", …) and runner.ts logged
 *     `outcomes: undefined`, discarding it. So production could report that three
 *     events failed with no candidate page but never which three, and the only way
 *     to find out was to re-run the repair script locally against prod data.
 *
 * One UPDATE per attempted event. Best-effort as a whole: this is bookkeeping, and
 * it must never be the reason a successfully harvested result fails to persist.
 */
export async function recordResultAttempts(
  outcomes: { eventId: string; reason: string; note?: string; coveragePct?: number }[],
  now: Date = new Date(),
): Promise<void> {
  if (!outcomes.length) return;

  // ── Store OF-CARD coverage, not the harvester's of-outstanding number ─────
  //
  // The outcome's `coveragePct` is harvested / expectedBouts, and expectedBouts is
  // only the bouts still SCHEDULED when the target was built. So it means "of what
  // was left", which is right for the harvester's own early-exit but is NOT the
  // event's completeness. Observed: "BKFC 86 MOHEGAN SUN LANE, expected 2,
  // coveragePct 100, verified" — on an ELEVEN-bout card where 2 were outstanding.
  //
  // resultCoverage() in lib/events compares this stored value against decided/total
  // of the whole card. Two different denominators, so the convergence test
  // (`pct <= lastCoveragePct`) was comparing incomparable numbers and would
  // essentially never fire — the exact thing convergence exists to do.
  //
  // Recomputed here from the fights AFTER persistence, so one definition of coverage
  // reaches the database, the UI and the doctor.
  const ids = [...new Set(outcomes.map((o) => o.eventId).filter(Boolean))];
  const fights = ids.length
    ? await prisma.fight
        .findMany({ where: { eventId: { in: ids } }, select: { eventId: true, result: true } })
        .catch(() => [] as { eventId: string | null; result: string }[])
    : [];
  const cardCoverage = new Map<string, number>();
  for (const id of ids) {
    const own = fights.filter((f) => f.eventId === id);
    if (!own.length) continue;
    const decided = own.filter((f) => f.result !== "SCHEDULED").length;
    cardCoverage.set(id, Math.round((decided / own.length) * 100));
  }

  await Promise.all(
    outcomes
      .filter((o) => o.eventId)
      .map((o) =>
        prisma.event
          .update({
            where: { id: o.eventId },
            data: {
              resultAttemptAt: now,
              resultAttempts: { increment: 1 },
              // The note carries the useful specifics for an error ("fetch 429"), so
              // keep it when there is one — `reason` alone is a category.
              resultAttemptReason: o.note ? `${o.reason}: ${o.note}`.slice(0, 500) : o.reason,
              // Of-CARD, from the map above — never the outcome's of-outstanding value.
              resultCoverage: cardCoverage.get(o.eventId) ?? null,
            },
          })
          .catch((e: unknown) => {
            // ONLY a missing row is tolerable — an event deleted mid-run is not worth
            // failing a harvest for. Everything else gets logged.
            //
            // This was a bare `.catch(() => undefined)` and it hid a real failure: run
            // against a database whose `resultCoverage` column did not exist yet and
            // EVERY update threw, so no attempt was ever recorded, the queue rotation
            // had nothing to sort by, and the doctor reported `attempts: 0` for events
            // that had just been harvested successfully. Silently swallowing a write
            // error is the same class of bug as the cron reporting 200 for a run in
            // which everything failed.
            const code = (e as { code?: string })?.code;
            if (code === "P2025") return; // record not found — fine
            log.error(
              { op: "wikicard.recordAttempt", eventId: o.eventId, code, err: (e as Error)?.message },
              "failed to record the result attempt — the harvest queue cannot rotate without this",
            );
          }),
      ),
  );
}

/**
 * How many events still carry each gap — for the repair report's before/after.
 *
 * The three headline counts are QUEUEABLE events: they apply the same
 * revisitable filter the queue does, so the report cannot claim a backlog the
 * job will never touch. `parked` is that difference, stated rather than hidden —
 * events excluded because their card is complete or their source is a one-shot
 * import. A number that quietly excludes things is how a 30-event permanent
 * miss looks like healthy progress.
 */
export async function countWikiGaps(now: Date = new Date()): Promise<{
  missingResultEvents: number;
  missingResultBouts: number;
  missingCardEvents: number;
  parkedStaticSource: number;
  parkedComplete: number;
}> {
  const revisitable = {
    resultsCompleteAt: null,
    ...(STATIC_IMPORT_SOURCES.length
      ? { NOT: { externalIds: { some: { source: { in: STATIC_IMPORT_SOURCES } } } } }
      : {}),
  };

  const [missingResultEvents, missingResultBouts, missingCardEvents, parkedStaticSource, parkedComplete] =
    await Promise.all([
    prisma.event.count({
      where: {
        date: { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { some: { result: "SCHEDULED" } },
        ...revisitable,
      },
    }),
    prisma.fight.count({
      where: {
        result: "SCHEDULED",
        date: { lt: now },
        event: { status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] }, ...revisitable },
      },
    }),
    prisma.event.count({
      where: {
        date: { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { none: {} },
        ...revisitable,
      },
    }),
    // Parked, and why. Both are events the queue deliberately will not touch.
    STATIC_IMPORT_SOURCES.length
      ? prisma.event.count({
          where: {
            date: { lt: now },
            fights: { some: { result: "SCHEDULED" } },
            externalIds: { some: { source: { in: STATIC_IMPORT_SOURCES } } },
          },
        })
      : Promise.resolve(0),
    prisma.event.count({ where: { resultsCompleteAt: { not: null } } }),
  ]);
  return {
    missingResultEvents,
    missingResultBouts,
    missingCardEvents,
    parkedStaticSource,
    parkedComplete,
  };
}
