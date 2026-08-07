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
import { projectChampions } from "@/lib/rankings/champions";
import { crawlOneArchive } from "@/lib/scraper/one/ingest";
import { applyDerivedRecords } from "@/lib/fighters/derive-records";
import { SPORTS } from "@/lib/sports";
import { syncONE } from "@/lib/scraper/one";
import { syncADCC } from "@/lib/scraper/adcc";
import { syncEspn, ESPN_LEAGUES, DEFAULT_LEAGUE_KEYS } from "@/lib/scraper/espn";
import {
  syncWikiCards, findWikiTargets, recordResultAttempts,
  type WikiGap, type WikiMode, type WikiHarvestReport, type ResultTier,
} from "@/lib/scraper/wikicard";
import { persistAggregated } from "@/services/sync/persist";
import { isSourceEnabled } from "@/lib/ingestion-registry";
import { runResultsIntelligence } from "@/lib/results/pipeline";
import type { Sport } from "@/lib/types";

export type RefreshKind =
  | "rankings" | "p4p" | "champions" | "events" | "results" | "news" | "odds" | "mma" | "people" | "enrich"
  | "bkfc" | "one" | "adcc" | "wikicards" | "espn";

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
  opts: { gap?: WikiGap; limit: number; mode?: WikiMode; promotion?: string; skip?: number; tier?: ResultTier },
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

  // Write each event's outcome to its own row BEFORE returning. This is what makes
  // the queue in findWikiTargets a rotation (see targets.ts) — without it the hourly
  // job re-attempts the same newest 12 events forever and the rest are never tried.
  await recordResultAttempts(h.report.outcomes);

  // Name the events that did NOT resolve, not just the count.
  //
  // This log line carried `outcomes: undefined` — the harvester computes a precise
  // per-event reason and it was explicitly stripped here, so production could say
  // "noCandidate=3" and never which 3. Aggregates tell you a subsystem is unhappy;
  // only the event names let you check the actual Wikipedia page and find out why.
  // Capped at 25 so one bad batch cannot write an unbounded log line.
  // `partial` counts as unresolved here — that is the whole point of the distinction.
  // An event that harvested 1 of 13 bouts is NOT done, and reporting it alongside the
  // outright failures is what stops a partial harvest reading as a success.
  const unresolved = h.report.outcomes
    .filter((o) => o.reason !== "verified")
    .slice(0, 25)
    .map((o) => ({
      event: o.event, reason: o.reason, page: o.page, type: o.candidateKind,
      expected: o.expectedBouts, harvested: o.matched, coveragePct: o.coveragePct, note: o.note,
    }));

  log.info(
    { ...h.report, outcomes: undefined, unresolved, gap: opts.gap ?? "all", mode: opts.mode ?? "incremental", written },
    "wikicards:runner:done",
  );
  return (
    `targets=${targets.length} verified=${h.report.withCard} written=${written} bouts=${h.report.bouts} ` +
    `searches=${h.report.queries}(${per(h.report.queries)}/t) parses=${h.report.parses}(${per(h.report.parses)}/t) ` +
    `rejected=${h.report.rejected} cacheHits=${h.report.cacheHits} ` +
    `partial=${tally("partial")} ` +
    `noCandidate=${tally("no_candidate")} allRejected=${tally("all_rejected")} noCard=${tally("no_card")} ` +
    `unverified=${tally("unverified")} errors=${tally("error")}` +
    (strategies ? ` via[${strategies}]` : "")
  );
}

/** Full harvest detail, for the repair script's report. */
export async function harvestWikiTargetsDetailed(
  opts: { gap?: WikiGap; limit: number; mode?: WikiMode; promotion?: string; skip?: number; tier?: ResultTier },
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

  // Same bookkeeping as the cron path — a `--historical` repair walking the backlog in
  // batches depends on it, or every batch re-selects the same head.
  await recordResultAttempts(h.report.outcomes);

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

/**
 * Run one target end-to-end inside a ScrapeJob lifecycle.
 *
 * Generic in the return value so cron routes that do NOT go through `refresh()`
 * can record a run too. `resolve-picks` and `ingest-feed` both hand-rolled their
 * own handler and so wrote no ScrapeJob row at all — meaning the two jobs closest
 * to the user-visible reward loop ("you called it") were the only ones with no run
 * history whatsoever, and a scheduler that quietly stopped firing them left no
 * trace. See lib/admin/cron-health.ts, which reads these rows.
 */
export async function runJob<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const job = await prisma.scrapeJob.create({ data: { target, status: "RUNNING", startedAt: new Date(), attempts: 1 } });
  try {
    const out = await fn();
    await prisma.scrapeJob.update({ where: { id: job.id }, data: { status: "SUCCESS", finishedAt: new Date() } });
    return out;
  } catch (e) {
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), error: (e as Error).message },
    });
    log.error({ target, err: (e as Error).message }, "job:failed");
    throw e;
  }
}

/** One target that threw. Kept separate from `results` so a caller can tell a
 *  failure from a success whose report happens to be a string. */
export interface RefreshFailure { target: string; error: string }

export interface RefreshOutcome {
  results: Record<string, number | string>;
  failed: RefreshFailure[];
}

/**
 * Refresh a whole entity-kind. Returns the per-target result map AND the list of
 * targets that threw.
 *
 * The failure list exists because `safe()` writes the error MESSAGE into
 * `results[target]`, which is indistinguishable from a legitimate string report
 * ("scanned=30 enriched=8"). The cron handler consequently answered 200 `ok:true`
 * for a run in which every single job had failed — and `curl -fsS --retry` in
 * render.yaml only reacts to an HTTP error, so Render showed the job green.
 *
 * That is how the results pipeline could be dead in production for weeks while
 * every dashboard said healthy: ENABLE_SCRAPER was "false", so the Wikipedia
 * fetch threw on the first call, the error was captured as a "result", and the
 * run was reported as a success. A silent no-op is the one outcome a scheduled
 * job must never be able to report.
 */
export interface RefreshOpts {
  /**
   * Cadence for the `results` kind — how far back this run looks.
   * recent (7d, hourly) · daily (90d) · deep (unbounded, weekly).
   * Defaults to `recent`, so the frequent job never scans history.
   */
  tier?: ResultTier;
}

export async function refreshDetailed(kind: RefreshKind, opts: RefreshOpts = {}): Promise<RefreshOutcome> {
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const results: Record<string, number | string> = {};
  const failed: RefreshFailure[] = [];
  const safe = (target: string, fn: () => Promise<number | string>) =>
    queue.add(async () => {
      try { results[target] = await runJob(target, fn); }
      catch (e) {
        const error = (e as Error).message;
        results[target] = error;
        failed.push({ target, error });
      }
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
      // 0. RECORDS FIRST — the rating engine reads Fighter.wins/losses/draws,
      //    and no provider that writes bouts ever writes those columns. Before
      //    this ran, 13 fighters out of 10,419 had a record while the database
      //    held 13,603 decided bouts, so isRankable() rejected everyone and the
      //    engine produced an empty list for every sport. It looked like a
      //    broken ranker; its input had simply never been populated.
      //
      //    Mode "grow": fills an empty record, and updates one that accounts for
      //    fewer bouts than we now hold. It cannot replace a fuller
      //    provider-published career record with our partial count.
      await safe("p4p:records", async () => {
        const r = await applyDerivedRecords({ apply: true, mode: "grow" });
        return `updated=${r.updated} preserved=${r.preserved} unchanged=${r.unchanged}`;
      });
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
      //
      // TIERED, so this can run often without re-reading history. `recent` (7
      // days) is the default because an event that ended three years ago cannot
      // acquire a result between 09:00 and 10:00 — only a card that just
      // happened can. The 90-day and unbounded sweeps are the same route on a
      // slower schedule (?tier=daily / ?tier=deep).
      await safe("results:wikicard", () =>
        harvestWikiTargets({ gap: "missing_result", limit: RESULT_BATCH, tier: opts.tier ?? "recent" }),
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
      // ── THIS WAS A NO-OP ────────────────────────────────────────────────
      // It logged `refresh:noop` and returned, every day, while the reported
      // symptom was "UFC champions occasionally outdated". Champions were only
      // ever written as a SIDE EFFECT of rank-0 rows inside the WEEKLY ranking
      // connector run, so a belt that changed hands on a Saturday could sit
      // wrong until the following Monday — and a division whose connector
      // publishes no titleholder had no champion at all, ever.
      //
      // Now it projects reigns from champion observations: the same evidence the
      // connectors already record, reconciled by tier, opening and closing
      // TitleReign rows so the history survives. Cheap when nothing changed —
      // a reign that already agrees with the evidence writes nothing.
      await safe("champions:project", async () => {
        const r = await projectChampions();
        return `titles=${r.titles} opened=${r.reignsOpened} closed=${r.reignsClosed} contested=${r.contested}`;
      });
      break;
    case "people":
      // Still needs per-fighter data (most imported fighters lack it) — no-op
      // until that lands. Unlike `champions` above, nothing in the product is
      // currently waiting on it.
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
      // shared pipeline's job (persistAggregated). The WRITE gate that used to
      // live here is REMOVED (2026-08-01): isSourceEnabled() always returns true,
      // so events/fighters are always persisted. The calls are kept as the seam
      // to reinstate it. Fetching still fails fast unless ENABLE_SCRAPER=true.
      // Rankings/news/videos are still returned by the harvest and still NOT
      // written — there is no aggregated persister for them, which is a missing
      // feature now rather than a policy gate.
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
      // persists, grouped by sport. The "one-events" write-gate is removed —
      // isSourceEnabled() always passes; the call is the reinstatement seam.
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
      // ── RESULTS, from the live-results archive ────────────────────────────
      // syncONE above brings in EVENTS. It cannot bring in bouts: ONE renders
      // its cards client-side, which is why 251 ONE events sat with no bouts at
      // all — the largest measured gap in the database.
      //
      // This walks the editorial results archive, which IS server-rendered, and
      // it RESUMES: the last index page reached is stored on the provider
      // checkpoint, so each nightly tick continues rather than re-reading
      // everything shallower. Once the archive is exhausted it flips to
      // incremental and only watches page 1 for new publications.
      //
      // Deliberately small per tick. This is a sustained crawl of somebody
      // else's server, and an unpaced run was rate-limited after a dozen fetches.
      await safe("one:results", async () => {
        const state = await crawlOneArchive({ pages: 3, limit: 12 });
        return (
          `page=${state.fromPage}→${state.nextPage} exhausted=${state.exhausted} ` +
          `bouts=${state.report.boutsAdded} written=${state.report.written} ` +
          `skipped=${state.report.skipped} failed=${state.report.failed}`
        );
      });
      break;
    case "adcc":
      // ADCC (adcombat.com) → BJJ events. Pure provider; shared pipeline persists.
      // The "adcc-events" write-gate is removed — isSourceEnabled() always passes.
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
    case "espn":
      // ESPN's public MMA scoreboard — UFC/PFL/Bellator/ONE/RIZIN, whole card
      // with winners, one request per league-year.
      //
      // The cron takes the CURRENT year only. That is the tier idea again: this
      // job exists to settle last night's card and pick up next week's
      // announcements, and a promotion's back catalogue does not change. History
      // is `npm run espn:backfill`, run deliberately.
      await safe("espn:sync", async () => {
        const year = new Date().getUTCFullYear();
        const leagues = ESPN_LEAGUES.filter((l) => DEFAULT_LEAGUE_KEYS.includes(l.key));
        const h = await syncEspn({ leagues, years: [year] });
        const bySport = new Map<Sport, typeof h.events>();
        for (const ev of h.events) {
          if (!bySport.has(ev.sport)) bySport.set(ev.sport, []);
          bySport.get(ev.sport)!.push(ev);
        }
        let written = 0;
        for (const [sport, list] of bySport) written += await persistAggregated(sport, "events", list);
        log.info(
          { cards: h.report.eventsSeen, bouts: h.report.boutsSeen, decided: h.report.boutsDecided, written },
          "espn:runner:done",
        );
        return `cards=${h.report.eventsSeen} bouts=${h.report.boutsSeen} decided=${h.report.boutsDecided} written=${written}`;
      });
      break;
    case "wikicards":
      // Backfill fight cards + RESULTS from Wikipedia (CC BY-SA) for past events.
      // Promotion-agnostic — it's the only source carrying bout winners/method for
      // BKFC/ONE (their sites render those client-side).
      //
      // TWO CALLS, not one, and that is the whole point of this job.
      //
      // It used to be a single `harvestWikiTargets({ limit })` covering both gaps.
      // findWikiTargets fills the batch RESULTS FIRST and only gives the card gap
      // `limit - rows.length` — correct for the hourly result job, fatal here.
      // This is the ONLY scheduled job that backfills empty cards, and whenever
      // the result queue had WIKICARD_BATCH or more entries (it routinely does)
      // the card gap got a budget of exactly zero. Twice a week, forever. That is
      // why ONE sat on 97 empty cards, every one of them "never attempted".
      //
      // Splitting the call gives the card gap its own guaranteed budget. Results
      // keep theirs, and they are also chased hourly by `results`, so the card
      // half is the part that only ever happens here.
      await safe("wikicards:results", () =>
        harvestWikiTargets({ gap: "missing_result", limit: WIKICARD_BATCH }),
      );
      await safe("wikicards:cards", () =>
        harvestWikiTargets({ gap: "missing_card", limit: WIKICARD_BATCH }),
      );
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
  return { results, failed };
}

/** Back-compatible shape for callers that only want the report map. */
export async function refresh(
  kind: RefreshKind,
  opts: RefreshOpts = {},
): Promise<Record<string, number | string>> {
  return (await refreshDetailed(kind, opts)).results;
}
