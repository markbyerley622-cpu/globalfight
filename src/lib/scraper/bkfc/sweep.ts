// ════════════════════════════════════════════════════════════════════════════
//  BKFC — which events to fetch this tick. PURE, so it is testable without a
//  network or a database. Same shape as the ONE sweep (one/sweep.ts), because
//  the constraint is the same and a second concept would be a second thing to
//  keep in step.
//
//  ── The arithmetic ────────────────────────────────────────────────────────
//  BKFC's sitemap lists 169 events, and each one now costs TWO requests: the
//  event page, then the scored feed it declares. At the production rate limit
//  (SCRAPER_RATE_LIMIT_MS=3000) a full sweep is ~17 minutes.
//
//  refresh-bkfc is driven by the `gf-cron-promotions` Render job, which curls
//  with `-m 900` — and it curls THREE routes in sequence (bkfc, one,
//  wikicards), so the whole job shares that budget. (The route's own
//  `maxDuration = 300` is a Vercel directive with no effect on Render; do not
//  size against it.) A full sweep does not fit, and without a cursor the run
//  would be cut off in the same place every time, leaving the tail permanently
//  unreachable — the exact defect found in the ONE provider.
//
//  The defaults spend ~2.5 minutes (24 events × 2 requests × 3s), which sweeps
//  the whole archive in about two weeks of twice-weekly ticks while leaving the
//  shared job budget mostly for its other two routes. To close it in one
//  sitting instead: `npm run backfill:bkfc -- --events`.
// ════════════════════════════════════════════════════════════════════════════

/** ProviderCheckpoint scope for the BKFC event sweep. */
export const BKFC_SWEEP_SCOPE = "events";

/**
 * How many of the freshest events to re-read every tick.
 *
 * BKFC's sitemap is ordered lastmod-descending, so this window is where a card
 * that just happened — and therefore just gained results — will be.
 */
export const BKFC_FRESH_WINDOW = Number(process.env.BKFC_FRESH_WINDOW ?? 8);
/** How many archive events to advance through every tick. */
export const BKFC_TAIL_WINDOW = Number(process.env.BKFC_TAIL_WINDOW ?? 16);

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
 * rather than throwing: a corrupt checkpoint must not stop ingestion.
 */
export function planBkfcSweep(
  total: number,
  cursor: number,
  fresh: number = BKFC_FRESH_WINDOW,
  tail: number = BKFC_TAIL_WINDOW,
): SweepPlan {
  if (!Number.isFinite(total) || total <= 0) return { indices: [], nextCursor: 0, wrapped: false };

  const freshCount = Math.min(Math.max(0, Math.trunc(fresh)), total);
  const indices = Array.from({ length: freshCount }, (_, i) => i);

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
