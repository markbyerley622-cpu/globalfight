// ════════════════════════════════════════════════════════════════════════
//  ADCC — orchestrator. `syncADCC()` fetches the single events listing page,
//  extracts + maps to canonical NormalizedEvent[] (sport BJJ), and returns.
//  Pure provider — the runner persists via the shared pipeline. Fetching is
//  gated by ENABLE_SCRAPER; writing by the "adcc-events" registry entry.
// ════════════════════════════════════════════════════════════════════════

import { fetchPage } from "../http";
import { log } from "../logger";
import { parseAdccEventsPage } from "./extract";
import { toNormalizedAdccEvent } from "./map";
import type { NormalizedEvent } from "@/services/providers/types";
import type { SyncOptions, AdccHarvest, AdccHarvestReport } from "./types";

const EVENTS_URL = process.env.ADCC_EVENTS_URL ?? "https://adcombat.com/adcc-events/";

/** Public entry point. Fetches + normalizes ADCC events into canonical entities. */
export async function syncADCC(opts: SyncOptions = {}): Promise<AdccHarvest> {
  const startedAt = new Date();
  const lastUpdated = startedAt.toISOString();
  const warnings: string[] = [];
  const report: AdccHarvestReport = {
    startedAt: lastUpdated, finishedAt: lastUpdated, durationMs: 0,
    discovered: 0, extracted: 0, rejected: 0, warnings,
  };

  let events: NormalizedEvent[] = [];
  try {
    const { html } = await fetchPage(EVENTS_URL);
    let raw = parseAdccEventsPage(html, startedAt);
    report.discovered = raw.length;
    if (opts.maxEvents && opts.maxEvents > 0) raw = raw.slice(0, opts.maxEvents);
    events = raw
      .filter((e) => {
        if (e.slug && e.name) return true;
        report.rejected += 1;
        return false;
      })
      .map((e) => toNormalizedAdccEvent(e, lastUpdated));
  } catch (e) {
    warnings.push(`adcc: ${(e as Error).message}`);
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  report.extracted = events.length;
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  log.info({ events: events.length, discovered: report.discovered, warnings: warnings.length }, "adcc:harvest:done");

  return { report, events };
}
