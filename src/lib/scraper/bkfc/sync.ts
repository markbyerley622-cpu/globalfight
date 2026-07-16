// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — orchestrator. `syncBKFC()` is the provider's entry point.
//
//  It is a PURE data provider: discover → fetch → extract → normalize →
//  validate → map to canonical Normalized* entities → return. It does NOT
//  write to Postgres, dedupe, snapshot, or emit persistence metrics — the
//  shared ingestion pipeline (services/sync/persist.ts) owns all of that. The
//  runner takes this harvest and hands events/fighters to persistAggregated().
//
//  Fetching is gated by the shared ENABLE_SCRAPER switch (see ../http.ts); the
//  WRITE gate (the "bkfc-*" ingestion-registry entries) lives in the runner,
//  not here — the provider knows nothing about ingestion policy.
// ════════════════════════════════════════════════════════════════════════

import PQueue from "p-queue";
import { fetchPage } from "../http";
import { log } from "../logger";
import { discover } from "./sitemap";
import { parseEventPage } from "./extract/events";
import { parseFighterPage } from "./extract/fighters";
import { parseRankingsPage } from "./extract/rankings";
import { parseArticlePage } from "./extract/news";
import { parseVideos } from "./extract/videos";
import { validateEvent, validateFighter, validateRanking, validateArticle } from "./validate";
import {
  toNormalizedEvent,
  toNormalizedFighter,
  toNormalizedRanking,
  toNormalizedArticle,
} from "./map";
import type { NormalizedEvent, NormalizedFighter } from "@/services/providers/types";
import type {
  SyncOptions, BkfcHarvest, SyncMode, BkfcEntity, BkfcVideo, HarvestReport,
} from "./types";

const CONCURRENCY = Number(process.env.BKFC_CONCURRENCY ?? 3);
const RANKINGS_URL = "https://www.bkfc.com/rankings";
const ALL_ENTITIES: BkfcEntity[] = ["events", "fighters", "rankings", "news", "videos"];

function zeroed(): Record<BkfcEntity, number> {
  return { events: 0, fighters: 0, rankings: 0, news: 0, videos: 0 };
}

/** Public entry point. Fetches + normalizes BKFC data and returns canonical entities. */
export async function syncBKFC(opts: SyncOptions = {}): Promise<BkfcHarvest> {
  const mode: SyncMode = opts.mode ?? "daily";
  const entities = opts.entities ?? ALL_ENTITIES;
  const maxPages = opts.maxPages ?? Number(process.env.BKFC_MAX_PAGES ?? 0);
  const startedAt = new Date();
  const lastUpdated = startedAt.toISOString();
  const warnings: string[] = [];
  const report: HarvestReport = {
    mode, startedAt: lastUpdated, finishedAt: lastUpdated, durationMs: 0,
    discovered: zeroed(), extracted: zeroed(), rejected: zeroed(), warnings,
  };

  const harvest: BkfcHarvest = {
    report, events: [], fighters: [], rankings: [], news: [], videos: [],
  };

  const videoSink = new Map<string, BkfcVideo>();
  const harvestVideos = (html: string) => {
    if (!entities.includes("videos")) return;
    for (const v of parseVideos(html)) videoSink.set(v.youtubeId ?? v.url, v);
  };

  const urls = await resolveUrls(mode, entities, opts.slug);

  // ── Events → NormalizedEvent[] ─────────────────────────────────────────────
  if (entities.includes("events") && urls.events.length) {
    report.discovered.events = urls.events.length;
    const events = await runPages(urls.events, maxPages, warnings, harvestVideos, (html, url) => {
      const e = parseEventPage(html, url);
      if (!e) return null;
      const v = validateEvent(e);
      warnings.push(...v.warnings);
      if (!v.ok || !v.value) { report.rejected.events += 1; return null; }
      return toNormalizedEvent(v.value, lastUpdated) as NormalizedEvent;
    });
    harvest.events = events;
    report.extracted.events = events.length;
  }

  // ── Fighters → NormalizedFighter[] ──────────────────────────────────────────
  if (entities.includes("fighters") && urls.fighters.length) {
    report.discovered.fighters = urls.fighters.length;
    const fighters = await runPages(urls.fighters, maxPages, warnings, harvestVideos, (html, url) => {
      const f = parseFighterPage(html, url);
      if (!f) return null;
      const v = validateFighter(f);
      warnings.push(...v.warnings);
      if (!v.ok || !v.value) { report.rejected.fighters += 1; return null; }
      return toNormalizedFighter(v.value, lastUpdated) as NormalizedFighter;
    });
    harvest.fighters = fighters;
    report.extracted.fighters = fighters.length;
  }

  // ── News → NormalizedArticle[] ──────────────────────────────────────────────
  if (entities.includes("news") && urls.news.length) {
    report.discovered.news = urls.news.length;
    const news = await runPages(urls.news, maxPages, warnings, harvestVideos, (html, url) => {
      const a = parseArticlePage(html, url);
      if (!a) return null;
      const v = validateArticle(a);
      warnings.push(...v.warnings);
      if (!v.ok || !v.value) { report.rejected.news += 1; return null; }
      return toNormalizedArticle(v.value, lastUpdated);
    });
    harvest.news = news;
    report.extracted.news = news.length;
  }

  // ── Rankings → one NormalizedRanking ────────────────────────────────────────
  if (entities.includes("rankings")) {
    try {
      const { html } = await fetchPage(RANKINGS_URL);
      const rows = parseRankingsPage(html)
        .map((r) => validateRanking(r))
        .filter((v) => (v.ok ? true : (warnings.push(...v.warnings), (report.rejected.rankings += 1), false)))
        .map((v) => v.value!)
        .filter(Boolean);
      report.discovered.rankings = rows.length;
      if (rows.length) {
        harvest.rankings = [toNormalizedRanking(rows, lastUpdated)];
        report.extracted.rankings = rows.length;
      }
    } catch (e) {
      warnings.push(`rankings: ${(e as Error).message}`);
    }
  }

  // ── Videos (harvested from the pages above) ─────────────────────────────────
  if (entities.includes("videos") && videoSink.size) {
    harvest.videos = [...videoSink.values()];
    report.discovered.videos = harvest.videos.length;
    report.extracted.videos = harvest.videos.length;
  }

  return finalize(harvest, startedAt);
}

/** Fetch + parse + map a list of page URLs with bounded concurrency. */
async function runPages<T>(
  list: string[],
  maxPages: number,
  warnings: string[],
  onHtml: (html: string, url: string) => void,
  parse: (html: string, url: string) => T | null,
): Promise<T[]> {
  const capped = maxPages > 0 ? list.slice(0, maxPages) : list;
  if (capped.length < list.length) {
    warnings.push(`capped at ${maxPages}/${list.length} pages (BKFC_MAX_PAGES) — remainder not fetched this run`);
  }
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const out: T[] = [];
  await Promise.all(
    capped.map((url) =>
      queue.add(async () => {
        try {
          const { html } = await fetchPage(url);
          onHtml(html, url);
          const value = parse(html, url);
          if (value) out.push(value);
        } catch (e) {
          warnings.push(`${url}: ${(e as Error).message}`);
        }
      }),
    ),
  );
  await queue.onIdle();
  return out;
}

/** Build the URL work list for a mode. */
async function resolveUrls(
  mode: SyncMode,
  entities: BkfcEntity[],
  slug: string | undefined,
): Promise<{ events: string[]; fighters: string[]; news: string[] }> {
  if (mode === "event") return { events: slug ? [`https://www.bkfc.com/events/${slug}`] : [], fighters: [], news: [] };
  if (mode === "fighter") return { events: [], fighters: slug ? [`https://www.bkfc.com/fighters/${slug}`] : [], news: [] };

  const found = await discover();
  if (mode === "hourly") return { events: found.events, fighters: [], news: found.news.slice(0, 25) };
  if (mode === "daily") return { events: found.events, fighters: found.fighters, news: found.news.slice(0, 100) };
  // full
  return {
    events: entities.includes("events") ? found.events : [],
    fighters: entities.includes("fighters") ? found.fighters : [],
    news: entities.includes("news") ? found.news : [],
  };
}

function finalize(harvest: BkfcHarvest, startedAt: Date): BkfcHarvest {
  const finishedAt = new Date();
  harvest.report.finishedAt = finishedAt.toISOString();
  harvest.report.durationMs = finishedAt.getTime() - startedAt.getTime();
  log.info(
    {
      mode: harvest.report.mode,
      events: harvest.events.length,
      fighters: harvest.fighters.length,
      news: harvest.news.length,
      rankings: harvest.rankings.length,
      videos: harvest.videos.length,
      warnings: harvest.report.warnings.length,
      durationMs: harvest.report.durationMs,
    },
    "bkfc:harvest:done",
  );
  return harvest;
}
