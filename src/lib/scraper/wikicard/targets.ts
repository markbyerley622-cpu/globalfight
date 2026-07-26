import "server-only";
import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import { candidate, type ResolvedEntity } from "@/lib/entities/resolve";
import { buildSearchLadder } from "./search-strategies";
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
  const windowed = mode === "incremental";
  const since = new Date(now.getTime() - (opts.windowDays ?? RESULT_BACKFILL_DAYS) * 86_400_000);

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
        ...filter,
      },
      orderBy: { date: "desc" },
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
        ...filter,
      },
      orderBy: { date: "desc" },
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

/** How many events still carry each gap — for the repair report's before/after. */
export async function countWikiGaps(now: Date = new Date()): Promise<{
  missingResultEvents: number;
  missingResultBouts: number;
  missingCardEvents: number;
}> {
  const [missingResultEvents, missingResultBouts, missingCardEvents] = await Promise.all([
    prisma.event.count({
      where: {
        date: { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { some: { result: "SCHEDULED" } },
      },
    }),
    prisma.fight.count({
      where: {
        result: "SCHEDULED",
        date: { lt: now },
        event: { status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] } },
      },
    }),
    prisma.event.count({
      where: {
        date: { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { none: {} },
      },
    }),
  ]);
  return { missingResultEvents, missingResultBouts, missingCardEvents };
}
