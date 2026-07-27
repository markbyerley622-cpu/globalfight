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
import { enrichArticleImages } from "@/lib/news/og-images";
import { syncBKFC } from "@/lib/scraper/bkfc";
import { generateAllP4P } from "@/lib/rankings/generate";
import { ingestAllRankings } from "@/lib/rankings/ingest";
import { ingestCuratedP4P } from "@/lib/rankings/curated/ingest";
import { SPORTS } from "@/lib/sports";
import { syncONE } from "@/lib/scraper/one";
import { syncADCC } from "@/lib/scraper/adcc";
import {
  syncWikiCards, findWikiTargets,
  type WikiGap, type WikiMode, type WikiHarvestReport,
} from "@/lib/scraper/wikicard";
import { persistAggregated } from "@/services/sync/persist";
import { isSourceEnabled } from "@/lib/ingestion-registry";
import { runResultsIntelligence } from "@/lib/results/pipeline";
import type { Sport } from "@/lib/types";

export type RefreshKind =
  | "rankings" | "p4p" | "champions" | "events" | "results" | "news" | "odds" | "mma" | "people" | "enrich"
  | "bkfc" | "one" | "adcc" | "wikicards";

const ENRICH_BATCH = Number(process.env.ENRICH_BATCH ?? 50);
/** Past events per wikicards run (each costs a search + a page fetch). */
const WIKICARD_BATCH = Number(process.env.WIKICARD_BATCH ?? 40);
/** Pending-result events per `results` run. Smaller — this one runs hourly. */
const RESULT_BATCH = Number(process.env.RESULT_BATCH ?? 12);
/** Bouts scanned per Results-Intelligence pass. Cheap — it reads already-ingested
 *  articles and makes no outbound requests, so this can be larger than the
 *  Wikipedia batch above. */
const RESULT_INTEL_BATCH = Number(process.env.RESULT_INTEL_BATCH ?? 40);

const CONCURRENCY = Number(process.env.SCRAPER_CONCURRENCY ?? 2);

/**
 * Harvest Wikipedia cards/results for the events that still need them, and
 * persist through the shared pipeline.
 *
 * Shared by `wikicards` (both gaps, twice-weekly) and `results` (result gap only,
 * hourly), because they are the same operation with a different target query —
 * and because the report has to SAY which gap it worked. A run that returns
 * "written=0" tells you nothing; "targets=8 gap=missing_result matched=6 written=5"
 * tells you whether the problem is the query, Wikipedia, or the extractor.
 */
export async function harvestWikiTargets(
  opts: { gap?: WikiGap; limit: number; mode?: WikiMode; promotion?: string; skip?: number },
): Promise<string> {
  const targets = await findWikiTargets(opts);
  if (!targets.length) return `targets=0 gap=${opts.gap ?? "all"} mode=${opts.mode ?? "incremental"}`;

  const h = await syncWikiCards(targets);

  let written = 0;
  const bySport = new Map<Sport, typeof h.events>();
  for (const e of h.events) {
    const s = e.sport as Sport;
    if (!bySport.has(s)) bySport.set(s, []);
    bySport.get(s)!.push(e);
  }
  // persistAggregated is what fires settlement (onResultWritten) for any bout this
  // write decides — so a repaired result settles its predictions in the same pass,
  // with no cron in between.
  for (const [sport, evs] of bySport) written += await persistAggregated(sport, "events", evs);

  // Name every non-verified outcome. "written=0" was uninterpretable; these counts
  // each point at a different subsystem — the search ladder, the extractor, or
  // genuinely-absent public coverage — and the retrieval numbers say what the run COST.
  const tally = (reason: string) => h.report.outcomes.filter((o) => o.reason === reason).length;
  const strategies = Object.entries(h.report.byStrategy)
    .filter(([, s]) => s.verified > 0)
    .map(([k, s]) => `${k}=${s.verified}`)
    .join(",");
  const per = (n: number) => (targets.length ? (n / targets.length).toFixed(1) : "0");

  log.info({ ...h.report, outcomes: undefined, gap: opts.gap ?? "all", mode: opts.mode ?? "incremental", written }, "wikicards:runner:done");
  return (
    `targets=${targets.length} verified=${h.report.withCard} written=${written} bouts=${h.report.bouts} ` +
    `searches=${h.report.queries}(${per(h.report.queries)}/t) parses=${h.report.parses}(${per(h.report.parses)}/t) ` +
    `rejected=${h.report.rejected} cacheHits=${h.report.cacheHits} ` +
    `noCandidate=${tally("no_candidate")} allRejected=${tally("all_rejected")} noCard=${tally("no_card")} ` +
    `unverified=${tally("unverified")} errors=${tally("error")}` +
    (strategies ? ` via[${strategies}]` : "")
  );
}

/** Full harvest detail, for the repair script's report. */
export async function harvestWikiTargetsDetailed(
  opts: { gap?: WikiGap; limit: number; mode?: WikiMode; promotion?: string; skip?: number },
): Promise<{ line: string; report: WikiHarvestReport | null; written: number }> {
  const targets = await findWikiTargets(opts);
  if (!targets.length) {
    return { line: `targets=0 gap=${opts.gap ?? "all"} mode=${opts.mode ?? "incremental"}`, report: null, written: 0 };
  }
  const h = await syncWikiCards(targets);
  let written = 0;
  const bySport = new Map<Sport, typeof h.events>();
  for (const e of h.events) {
    const s = e.sport as Sport;
    if (!bySport.has(s)) bySport.set(s, []);
    bySport.get(s)!.push(e);
  }
  for (const [sport, evs] of bySport) written += await persistAggregated(sport, "events", evs);
  const per = (n: number) => (targets.length ? (n / targets.length).toFixed(1) : "0");
  return {
    line:
      `targets=${targets.length} verified=${h.report.withCard} written=${written} bouts=${h.report.bouts} ` +
      `searches=${h.report.queries}(${per(h.report.queries)}/t) parses=${h.report.parses}(${per(h.report.parses)}/t) ` +
      `rejected=${h.report.rejected} cacheHits=${h.report.cacheHits}`,
    report: h.report,
    written,
  };
}

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
      // Two coexisting P4P sources, in precedence order:
      //  1. CURATED — source-backed cross-sport lists (BJJ, Muay Thai, Kickboxing,
      //     Wrestling, Bare Knuckle) with provenance. Ingested FIRST so the rating
      //     engine then skips those sports.
      //  2. RATING ENGINE — record-based P4P for the sports curated doesn't cover
      //     (Boxing, MMA). Never clobbers curated. See docs/RANKING_ENGINE.md.
      await safe("p4p:curated", async () =>
        (await ingestCuratedP4P()).reduce((n, r) => n + r.ranked, 0),
      );
      await safe("p4p:generate", async () =>
        (await generateAllP4P(SPORTS.map((s) => s.value))).reduce((n, r) => n + r.ranked, 0),
      );
      break;
    case "rankings":
      // Divisional rankings from the licensed ranking connectors (official
      // sanctioning bodies etc.). Gated behind RANKINGS_INGEST_ENABLED *and*
      // each source's per-source licence flag; BoxRec is blocked in code. When
      // the gate is off this is a no-op, so it's safe to schedule unconditionally.
      await safe("rankings:ingest", async () =>
        (await ingestAllRankings()).reduce((n, r) => n + r.imported, 0),
      );
      break;
    case "results":
      // RESULTS BACKFILL — the job that closes "Result pending".
      //
      // This was a no-op, and combined with the wikicards target query only
      // looking at events with NO card, nothing in the system ever went back for
      // the outcome of a card that was created ahead of time. An event whose bell
      // rang last night showed its matchup and "results aren't in yet" — forever.
      //
      // It runs the same licensed Wikipedia path as `wikicards`, but targeted at
      // the RESULT gap only and over a tight recent window, so it is cheap enough
      // to run hourly. Card backfill stays on the wikicards schedule.
      await safe("results:wikicard", () =>
        harvestWikiTargets({ gap: "missing_result", limit: RESULT_BATCH }),
      );

      // RESULTS INTELLIGENCE, second and deliberately after Wikipedia.
      //
      // Wikipedia is authoritative but slow — a card that finished last night is
      // often not on Wikipedia for hours, while the news feeds we already ingest
      // carry the outcome within minutes. This pass reads those feeds as EVIDENCE
      // and scores a candidate per bout.
      //
      // Running it second means any bout Wikipedia just settled is already decided
      // and gets skipped, so the fast path only ever fills the gap the slow path
      // has not reached. It cannot itself publish anything the confidence engine
      // did not mark VERIFIED, and everything else waits for an operator — see
      // lib/results/pipeline for the settlement gate.
      // Reported as a LINE, not a count, for the same reason the Wikipedia harvest
      // is: "0" is uninterpretable, while these five numbers each point at a
      // different place to look — no evidence means the news pass has not run or the
      // extractor rejected everything, queued means it is working and waiting on a
      // human, conflicted means sources disagree.
      await safe("results:intelligence", async () => {
        const r = await runResultsIntelligence(RESULT_INTEL_BATCH);
        return (
          `scanned=${r.scanned} evidence=${r.evidence} verified=${r.verified} ` +
          `queued=${r.queued} conflicted=${r.conflicted}`
        );
      });
      break;
    case "champions":
    case "people":
      // Champions/people still need per-fighter data (most imported fighters lack
      // it) — no-op until that lands.
      log.info({ kind }, "refresh:noop (curated — served by API providers)");
      break;
    case "events":
      // Multi-sport upcoming events from configured official calendar feeds
      // (Muay Thai, Kickboxing, BJJ, Bare Knuckle, Wrestling, Judo, Taekwondo,
      // Sambo). Boxing/MMA come from the Odds pipeline. See src/lib/events.
      await safe("events:adapters", () => ingestAdapterEvents());
      break;
    case "news":
      await safe("news", () => ingestNews()); // pull all combat-sports RSS feeds → Article table
      // Most RSS carries no image; fetch each new article's own OG image so cards
      // show a real picture instead of a generated placeholder.
      await safe("news:og-images", async () => {
        const r = await enrichArticleImages(40);
        return `scanned=${r.scanned} found=${r.found} missed=${r.missed} failed=${r.failed}`;
      });
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
        // syncADCC swallows a failed fetch into report.warnings and returns zero
        // events, so reporting `written` alone made a CLOSED ENABLE_SCRAPER gate
        // — and equally a broken extractor — indistinguishable from "ADCC has no
        // upcoming events". BKFC/ONE surface the gate because their errors
        // propagate; ADCC hid it and cost a wrong diagnosis. Say why it was zero.
        if (written === 0 && h.report.warnings.length) {
          return `written=0 discovered=${h.report.discovered} — ${h.report.warnings.join("; ")}`;
        }
        return written;
      });
      break;
    case "wikicards":
      // Backfill fight cards + RESULTS from Wikipedia (CC BY-SA) for past events.
      // Promotion-agnostic — it's the only source carrying bout winners/method for
      // BKFC/ONE (their sites render those client-side). findWikiTargets covers
      // BOTH gaps (missing card, missing result), results first.
      await safe("wikicards", () => harvestWikiTargets({ limit: WIKICARD_BATCH }));
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
