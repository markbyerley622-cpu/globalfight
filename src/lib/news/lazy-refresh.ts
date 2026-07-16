// ════════════════════════════════════════════════════════════════════════
//  News self-heal — a traffic-driven backstop for the ingestion cron.
//
//  The scheduled /api/cron/refresh-news job is the primary updater, but if it
//  isn't firing (misconfigured host cron, missing SCRAPE_CRON_SECRET, paused
//  scheduler…) the Article table can go stale for days. This makes the news
//  read path self-healing: when the freshest article is older than the stale
//  window, a single throttled background ingest runs and busts the cache, so
//  the next visitor sees fresh news — no external scheduler required.
//
//  Server-only, fire-and-forget, de-duped + throttled per server instance.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { ingestNews } from "./ingest";
import { invalidate } from "@/lib/cache";
import { log } from "@/lib/scraper/logger";

const STALE_MS = 6 * 60 * 60 * 1000; // articles older than 6h → refresh
const MIN_GAP_MS = 60 * 60 * 1000; // at most one self-heal per hour per instance

let lastRun = 0;
let inflight: Promise<void> | null = null;

/**
 * Kick a background news ingest if the freshest article is stale. Never blocks
 * the caller and never throws. Pass the newest article's publish time (or null
 * when the table is empty / unreadable, which also triggers a refresh).
 */
export function maybeRefreshNews(newest: Date | string | null | undefined): void {
  // Never during the production build (would storm every RSS feed while
  // prerendering) and never without a DB to write to (local dev / previews).
  if (!process.env.DATABASE_URL || process.env.NEXT_PHASE === "phase-production-build") return;

  const newestMs = newest ? new Date(newest).getTime() : 0;
  const now = Date.now();
  const stale = !newestMs || now - newestMs > STALE_MS;
  if (!stale || inflight || now - lastRun < MIN_GAP_MS) return;

  lastRun = now;
  log.info({ newestAgeMs: newestMs ? now - newestMs : null }, "news:self-heal start");
  inflight = ingestNews()
    .then(async (n) => {
      await invalidate("articles:all");
      log.info({ upserted: n }, "news:self-heal done");
    })
    .catch((e) => log.warn({ err: (e as Error).message }, "news:self-heal failed"))
    .finally(() => {
      inflight = null;
    });
}
