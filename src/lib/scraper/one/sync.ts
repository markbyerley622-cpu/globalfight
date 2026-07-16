// ════════════════════════════════════════════════════════════════════════
//  ONE Championship — orchestrator. `syncONE()` is a PURE data provider:
//  discover events → fetch → extract (JSON-LD) → validate → map to canonical
//  NormalizedEvent → return. No persistence — the runner hands the harvest to
//  the shared persistAggregated() pipeline (grouped by the per-event sport).
//
//  Fetching is gated by the shared ENABLE_SCRAPER switch (../http.ts); the write
//  gate ("one-*" ingestion-registry entries) lives in the runner.
// ════════════════════════════════════════════════════════════════════════

import PQueue from "p-queue";
import { fetchPage } from "../http";
import { log } from "../logger";
import { discoverEvents } from "./sitemap";
import { parseOneEventPage } from "./extract/events";
import { validateOneEvent } from "./validate";
import { toNormalizedOneEvent } from "./map";
import type { NormalizedEvent } from "@/services/providers/types";
import type { SyncOptions, OneHarvest, OneHarvestReport } from "./types";

const CONCURRENCY = Number(process.env.ONE_CONCURRENCY ?? 3);

/** Public entry point. Fetches + normalizes ONE events into canonical entities. */
export async function syncONE(opts: SyncOptions = {}): Promise<OneHarvest> {
  const maxPages = opts.maxPages ?? Number(process.env.ONE_MAX_PAGES ?? 0);
  const startedAt = new Date();
  const lastUpdated = startedAt.toISOString();
  const warnings: string[] = [];
  const report: OneHarvestReport = {
    startedAt: lastUpdated, finishedAt: lastUpdated, durationMs: 0,
    discovered: { events: 0 }, extracted: { events: 0, fighters: 0 }, rejected: { events: 0 }, warnings,
  };

  const urls = opts.slug ? [`https://www.onefc.com/events/${opts.slug}/`] : await discoverEvents();
  report.discovered.events = urls.length;
  const capped = maxPages > 0 ? urls.slice(0, maxPages) : urls;
  if (capped.length < urls.length) {
    warnings.push(`capped at ${maxPages}/${urls.length} events (ONE_MAX_PAGES)`);
  }

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const events: NormalizedEvent[] = [];
  await Promise.all(
    capped.map((url) =>
      queue.add(async () => {
        try {
          const { html } = await fetchPage(url);
          const e = parseOneEventPage(html, url, startedAt);
          if (!e) return;
          const v = validateOneEvent(e);
          warnings.push(...v.warnings);
          if (!v.ok || !v.value) { report.rejected.events += 1; return; }
          events.push(toNormalizedOneEvent(v.value, lastUpdated));
        } catch (err) {
          warnings.push(`${url}: ${(err as Error).message}`);
        }
      }),
    ),
  );
  await queue.onIdle();

  events.sort((a, b) => a.date.localeCompare(b.date));
  report.extracted.events = events.length;
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  log.info(
    { events: events.length, discovered: report.discovered.events, warnings: warnings.length, durationMs: report.durationMs },
    "one:harvest:done",
  );

  return { report, events, fighters: [] };
}
