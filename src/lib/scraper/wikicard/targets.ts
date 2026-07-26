import "server-only";
import { prisma } from "@/lib/db";
import type { Sport } from "@/lib/types";
import type { WikiTarget } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Which past events still need something from Wikipedia.
//
//  This used to be `{ fights: { none: {} } }` — events with NO card at all — and
//  that single clause is why completed cards sat on "Result pending" forever.
//
//  A boxing or MMA event is created DAYS AHEAD with its full card (from the odds
//  and events pipelines) and no results. It therefore has fights, so it never
//  matched `fights: none`, so the only source that carries bout winners never
//  looked at it again. The bell rang, the card stayed pending, and nothing in the
//  system was going to fix it. `refresh-results` being a no-op removed the other
//  path that could have.
//
//  There are TWO kinds of gap, and both need harvesting:
//    MISSING_CARD  — a past event with no bouts at all.
//    MISSING_RESULT — a past event whose bouts exist but carry no outcome.
//
//  The result gap is bounded to a recent window: Wikipedia is not going to
//  publish a results table for a small card from two years ago, and asking every
//  run is a permanent tax on the rate limit for nothing.
// ════════════════════════════════════════════════════════════════════════════

/** How far back to chase MISSING RESULTS. Beyond this it's history, not a lag. */
export const RESULT_BACKFILL_DAYS = 21;

export type WikiGap = "missing_card" | "missing_result";

export interface WikiTargetRow extends WikiTarget {
  gap: WikiGap;
  promotion: string | null;
}

export interface FindTargetsOpts {
  limit?: number;
  /** Case-insensitive promotion filter (the script's second argument). */
  promotion?: string;
  /** Restrict to one gap kind. Default: both, results first. */
  gap?: WikiGap;
  now?: Date;
  resultBackfillDays?: number;
}

/**
 * Past events that need a card or a result, RESULTS FIRST.
 *
 * The ordering is the point. A card that ended eight hours ago and shows "Result
 * pending" to every visitor is worth more than a 2019 event with no bouts, so it
 * gets the batch first. Card backfill takes whatever budget is left.
 */
export async function findWikiTargets(opts: FindTargetsOpts = {}): Promise<WikiTargetRow[]> {
  const limit = Math.max(1, opts.limit ?? 25);
  const now = opts.now ?? new Date();
  const promoFilter = opts.promotion
    ? { promotion: { contains: opts.promotion, mode: "insensitive" as const } }
    : {};
  const since = new Date(
    now.getTime() - (opts.resultBackfillDays ?? RESULT_BACKFILL_DAYS) * 86_400_000,
  );

  const select = { name: true, date: true, sport: true, promotion: true } as const;
  const out: WikiTargetRow[] = [];

  // ── Gap 1: the card happened, the bouts are there, no outcome was ever
  // ingested. `some: { result: "SCHEDULED" }` is the whole fix — an event with a
  // card is no longer invisible to the only source that carries winners.
  if (opts.gap !== "missing_card") {
    const rows = await prisma.event.findMany({
      where: {
        date: { gte: since, lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { some: { result: "SCHEDULED" } },
        ...promoFilter,
      },
      orderBy: { date: "desc" },
      take: limit,
      select,
    });
    out.push(...rows.map((r) => toTarget(r, "missing_result")));
  }

  // ── Gap 2: no card at all. Unbounded in time — a page may appear years later,
  // and a card is worth backfilling whenever we can get it.
  if (opts.gap !== "missing_result" && out.length < limit) {
    const rows = await prisma.event.findMany({
      where: {
        date: { lt: now },
        status: { notIn: ["DRAFT", "CANCELLED", "POSTPONED"] },
        fights: { none: {} },
        ...promoFilter,
      },
      orderBy: { date: "desc" },
      take: limit - out.length,
      select,
    });
    out.push(...rows.map((r) => toTarget(r, "missing_card")));
  }

  return out;
}

function toTarget(
  row: { name: string; date: Date; sport: string; promotion: string | null },
  gap: WikiGap,
): WikiTargetRow {
  return {
    name: row.name,
    date: row.date.toISOString(),
    sport: row.sport as Sport,
    gap,
    promotion: row.promotion,
  };
}
