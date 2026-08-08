// ════════════════════════════════════════════════════════════════════════════
//  ONE Championship — which events to fetch this tick. PURE, so it is testable
//  without a network or a database.
//
//  ── The arithmetic that forces this ───────────────────────────────────────
//  ONE's sitemap lists 423 events. The shared fetcher paces at 5s per request
//  (SCRAPER_RATE_LIMIT_MS), and /api/cron/refresh-one has maxDuration = 300.
//  A full sweep is therefore ~35 minutes against a 5-minute ceiling: the run is
//  killed roughly 60 events in, EVERY TIME, and — with no cursor — those are the
//  same 60 events on every run. The remaining ~360 would never be fetched at all.
//
//  ── Two windows ───────────────────────────────────────────────────────────
//  ONE's sitemap is ordered lastmod-descending, so index 0 is whatever ONE
//  touched most recently. That ordering is worth exploiting rather than
//  flattening, because the events that change are exactly the ones we want:
//  a card being announced, or results being posted after a show.
//
//    FRESH  a fixed prefix, re-read every tick. Catches announcements and
//           results within one cron interval.
//    TAIL   a window that ROTATES through the archive behind the fresh prefix,
//           resuming from the stored cursor. Guarantees every event is
//           eventually visited instead of the tail starving forever.
//
//  The cursor is opaque to this module — the runner reads and writes it on the
//  ProviderCheckpoint row, the same place the results crawl keeps its position.
// ════════════════════════════════════════════════════════════════════════════

/**
 * ProviderCheckpoint scope for the event sweep.
 *
 * Distinct from the results crawl's "archive" scope: they resume through
 * different lists (sitemap events vs editorial index pages) and sharing a row
 * would make each run clobber the other's position.
 */
export const ONE_SWEEP_SCOPE = "events";

/** How many of the freshest events to re-read every tick. */
export const ONE_FRESH_WINDOW = Number(process.env.ONE_FRESH_WINDOW ?? 16);
/** How many archive events to advance through every tick. */
export const ONE_TAIL_WINDOW = Number(process.env.ONE_TAIL_WINDOW ?? 16);

export interface SweepPlan {
  /** Indices into the discovered (lastmod-desc) URL list, fresh window first. */
  indices: number[];
  /** Where the NEXT run should resume its tail window. */
  nextCursor: number;
  /** True when the tail window ran off the end and restarted at the archive head. */
  wrapped: boolean;
}

/**
 * Plan one tick's fetches.
 *
 * `cursor` is the previous run's `nextCursor`. Anything nonsensical — negative,
 * NaN, past the end, or inside the fresh prefix — resets to the archive head
 * rather than throwing, because a corrupt checkpoint must not stop ingestion.
 */
export function planOneSweep(
  total: number,
  cursor: number,
  fresh: number = ONE_FRESH_WINDOW,
  tail: number = ONE_TAIL_WINDOW,
): SweepPlan {
  if (!Number.isFinite(total) || total <= 0) return { indices: [], nextCursor: 0, wrapped: false };

  const freshCount = Math.min(Math.max(0, Math.trunc(fresh)), total);
  const indices = Array.from({ length: freshCount }, (_, i) => i);

  // The archive is everything BEHIND the fresh prefix. Rotating over the whole
  // list instead would re-fetch the prefix twice in the same tick.
  const archiveStart = freshCount;
  const archiveSize = total - archiveStart;
  const take = Math.min(Math.max(0, Math.trunc(tail)), archiveSize);
  if (take <= 0) return { indices, nextCursor: archiveStart, wrapped: false };

  let pos =
    Number.isFinite(cursor) && cursor >= archiveStart && cursor < total
      ? Math.trunc(cursor)
      : archiveStart;

  let wrapped = false;
  for (let n = 0; n < take; n++) {
    indices.push(pos);
    pos += 1;
    if (pos >= total) {
      pos = archiveStart;
      wrapped = true;
    }
  }

  return { indices, nextCursor: pos, wrapped };
}
