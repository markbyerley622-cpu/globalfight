// ════════════════════════════════════════════════════════════════════════════
//  ONE Championship — which events to fetch this tick. PURE, so it is testable
//  without a network or a database.
//
//  ── The arithmetic that forces this ───────────────────────────────────────
//  ONE's sitemap lists 423 events, and production paces at 3s per request
//  (SCRAPER_RATE_LIMIT_MS in render.yaml — 800ms drew 199 HTTP 429s out of 224
//  event pages, so this rate is bought with experience). A full sweep is
//  therefore ~21 minutes. Whatever the request ceiling is, it is less than that:
//  the run is cut off partway, and WITHOUT A CURSOR it is cut off in the same
//  place every time, leaving the rest of the archive unreachable by construction
//  rather than merely slow.
//
//  ── What the ceiling actually is ──────────────────────────────────────────
//  Read this before retuning, because the obvious number is the wrong one.
//  refresh-one/route.ts declares `maxDuration = 300`, which is a VERCEL
//  serverless directive and has no effect on this deployment: production is a
//  long-running Next server on Render, driven by the `gf-cron-promotions` job,
//  whose startCommand curls the route with `-m 900`. The real budget is 900s,
//  shared with the results-archive crawl in the same request.
//
//  The defaults below spend ~290s of that (96 events × 3s), which leaves room
//  for the results crawl, the persist writes, and a rate limit that someone
//  later decides to loosen. Both are env-tunable, because the numbers that set
//  them are themselves configuration.
//
//  At 96 events per tick, twice a week, the archive behind the fresh window is
//  swept in about two weeks — versus three months at a 16-event window. To close
//  it in one sitting instead, run `npm run backfill:one -- --events`, which
//  sweeps the whole sitemap and leaves the cron to maintain the front of it.
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

/**
 * How many of the freshest events to re-read every tick.
 *
 * Sized to cover more than a cron interval of ONE's output: the promotion runs
 * roughly weekly, and this job fires twice a week, so 24 is several cycles of
 * slack. Announcements and posted results are caught without waiting for the
 * rotating window to come round.
 */
export const ONE_FRESH_WINDOW = Number(process.env.ONE_FRESH_WINDOW ?? 24);
/** How many archive events to advance through every tick. See the budget above. */
export const ONE_TAIL_WINDOW = Number(process.env.ONE_TAIL_WINDOW ?? 72);

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
