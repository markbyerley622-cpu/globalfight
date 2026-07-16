// ════════════════════════════════════════════════════════════════════════
//  Scrape runner — orchestrates scrape → ingest with ScrapeJob bookkeeping.
//
//  Each refresh kind enqueues one ScrapeJob per target, then works them with
//  bounded concurrency (p-queue). Jobs are retryable and observable via the
//  ScrapeJob table (status, attempts, error, timings).
// ════════════════════════════════════════════════════════════════════════

import PQueue from "p-queue";
import { prisma } from "@/lib/db";
import { log } from "./logger";
import { scrapeUfcRoster } from "./mma";
import { persistMmaRoster } from "./ingest";
import { ingestOdds } from "@/lib/odds/ingest";
import { ingestAdapterEvents } from "@/lib/events/ingest";
import { enrichPending } from "@/lib/enrich/enrich";
import { ingestNews } from "@/lib/news/ingest";
import { syncBKFC } from "@/lib/scraper/bkfc";
import { syncONE } from "@/lib/scraper/one";
import { syncADCC } from "@/lib/scraper/adcc";
import { syncWikiCards } from "@/lib/scraper/wikicard";
import { persistAggregated } from "@/services/sync/persist";
import { isSourceEnabled } from "@/lib/ingestion-registry";
import type { Sport } from "@/lib/types";

export type RefreshKind =
  | "rankings" | "p4p" | "champions" | "events" | "results" | "news" | "odds" | "mma" | "people" | "enrich"
  | "bkfc" | "one" | "adcc" | "wikicards";

const ENRICH_BATCH = Number(process.env.ENRICH_BATCH ?? 50);
/** Past events per wikicards run (each costs a search + a page fetch). */
const WIKICARD_BATCH = Number(process.env.WIKICARD_BATCH ?? 40);

const CONCURRENCY = Number(process.env.SCRAPER_CONCURRENCY ?? 2);

/** Run one target end-to-end inside a ScrapeJob lifecycle. */
// `number | string`: most jobs report a row count, but some report a short status
// ("scanned=30 enriched=8 photos=0"). `results` has always been
// Record<string, number | string> — only this signature was narrower.
async function runJob(target: string, fn: () => Promise<number | string>): Promise<number | string> {
  const job = await prisma.scrapeJob.create({ data: { target, status: "RUNNING", startedAt: new Date(), attempts: 1 } });
  try {
    const count = await fn();
    await prisma.scrapeJob.update({ where: { id: job.id }, data: { status: "SUCCESS", finishedAt: new Date() } });
    return count;
  } catch (e) {
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), error: (e as Error).message },
    });
    log.error({ target, err: (e as Error).message }, "job:failed");
    throw e;
  }
}

/** Refresh a whole entity-kind. Returns a per-target result map. */
export async function refresh(kind: RefreshKind): Promise<Record<string, number | string>> {
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const results: Record<string, number | string> = {};
  const safe = (target: string, fn: () => Promise<number | string>) =>
    queue.add(async () => {
      try { results[target] = await runJob(target, fn); }
      catch (e) { results[target] = (e as Error).message; }
    });

  switch (kind) {
    // BoxRec removed — rankings / p4p / champions / events / results / people are
    // no longer scraped. These entities now come from the licensed API providers
    // (src/services) + the mock-data layer. Kept as no-ops so cron routes and the
    // sync-fallback mapping keep compiling and simply do nothing here.
    case "p4p":
    case "rankings":
    case "champions":
    case "results":
    case "people":
      log.info({ kind }, "refresh:noop (BoxRec removed — served by API providers)");
      break;
    case "events":
      // Multi-sport upcoming events from configured official calendar feeds
      // (Muay Thai, Kickboxing, BJJ, Bare Knuckle, Wrestling, Judo, Taekwondo,
      // Sambo). Boxing/MMA come from the Odds pipeline. See src/lib/events.
      await safe("events:adapters", () => ingestAdapterEvents());
      break;
    case "news":
      await safe("news", () => ingestNews()); // pull all combat-sports RSS feeds → Article table
      break;
    case "odds":
      await safe("odds", async () => ingestOdds()); // real bookmaker lines (licensed odds feed)
      break;
    case "mma":
      await safe("mma:roster", async () => persistMmaRoster(await scrapeUfcRoster()));
      break;
    case "bkfc":
      // BKFC (bkfc.com) → canonical Normalized* entities (sport=BARE_KNUCKLE).
      // The PROVIDER only acquires + transforms; PERSISTENCE + dedupe are the
      // shared pipeline's job (persistAggregated). The WRITE gate lives here:
      // events/fighters are only persisted when their "bkfc-*" ingestion source
      // is enabled. Otherwise the run is a harvest (fetch fails fast anyway
      // unless ENABLE_SCRAPER=true). Rankings/news/videos are returned by the
      // harvest but not written by the aggregated pipeline (policy-gated / no
      // aggregated persister yet).
      await safe("bkfc:sync", async () => {
        const h = await syncBKFC({ mode: "daily" });
        let written = 0;
        if (isSourceEnabled("bkfc-fighters")) written += await persistAggregated("BARE_KNUCKLE", "fighters", h.fighters);
        if (isSourceEnabled("bkfc-events")) written += await persistAggregated("BARE_KNUCKLE", "events", h.events);
        log.info(
          { harvested: h.report.extracted, written, persistedFighters: isSourceEnabled("bkfc-fighters"), persistedEvents: isSourceEnabled("bkfc-events") },
          "bkfc:runner:done",
        );
        return written;
      });
      break;
    case "one":
      // ONE Championship (onefc.com) → events; sport per-event (Friday Fights →
      // MUAY_THAI / KICKBOXING, else MMA). Pure provider; shared pipeline
      // persists, grouped by sport. Write-gate = the "one-events" registry entry.
      await safe("one:sync", async () => {
        const h = await syncONE();
        let written = 0;
        if (isSourceEnabled("one-events")) {
          const bySport = new Map<Sport, typeof h.events>();
          for (const e of h.events) {
            const s = (e as { sport: Sport }).sport;
            if (!bySport.has(s)) bySport.set(s, []);
            bySport.get(s)!.push(e);
          }
          for (const [sport, evs] of bySport) written += await persistAggregated(sport, "events", evs);
        }
        log.info({ harvested: h.report.extracted, written }, "one:runner:done");
        return written;
      });
      break;
    case "adcc":
      // ADCC (adcombat.com) → BJJ events. Pure provider; shared pipeline persists.
      // Write-gate = the "adcc-events" registry entry.
      await safe("adcc:sync", async () => {
        const h = await syncADCC();
        let written = 0;
        if (isSourceEnabled("adcc-events")) written = await persistAggregated("BJJ", "events", h.events);
        log.info({ harvested: h.report.extracted, written }, "adcc:runner:done");
        return written;
      });
      break;
    case "wikicards":
      // Backfill fight cards + RESULTS from Wikipedia (CC BY-SA) for past events
      // that have no card. Promotion-agnostic — it's the only source carrying
      // bout winners/method for BKFC/ONE (their sites render those client-side).
      await safe("wikicards", async () => {
        const rows = await prisma.event.findMany({
          where: { fights: { none: {} }, date: { lt: new Date() } },
          orderBy: { date: "desc" },
          take: WIKICARD_BATCH,
          select: { name: true, date: true, sport: true },
        });
        const h = await syncWikiCards(
          rows.map((r) => ({ name: r.name, date: r.date.toISOString(), sport: r.sport as Sport })),
        );
        let written = 0;
        const bySport = new Map<Sport, typeof h.events>();
        for (const e of h.events) {
          const s = e.sport as Sport;
          if (!bySport.has(s)) bySport.set(s, []);
          bySport.get(s)!.push(e);
        }
        for (const [sport, evs] of bySport) written += await persistAggregated(sport, "events", evs);
        log.info({ ...h.report, written }, "wikicards:runner:done");
        return written;
      });
      break;
    case "enrich":
      // Profile enrichment: photos + bio for new/stale fighters.
      await safe("enrich", async () => {
        const r = await enrichPending(ENRICH_BATCH);
        // Report scanned/enriched/photos, not just `enriched`. `enriched` counts
        // any field filled (height, reach, bio), so it reads as success while
        // zero photos land — which is exactly what a fail-closed
        // MEDIA_INGESTION_ENABLED looks like from outside. `photos` is the only
        // number that answers "why are there no fighter images", and it was
        // being computed and thrown away.
        return `scanned=${r.scanned} enriched=${r.enriched} photos=${r.photos}`;
      });
      break;
  }

  await queue.onIdle();
  return results;
}
