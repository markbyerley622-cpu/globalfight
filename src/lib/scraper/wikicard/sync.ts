// ════════════════════════════════════════════════════════════════════════
//  Wikipedia card provider — `syncWikiCards()`.
//
//  PURE provider: walks each target's SEARCH LADDER until a candidate page is
//  ACCEPTED, and returns canonical NormalizedEvent[] carrying the card. The caller
//  hands them to persistAggregated, which resolves the event by name+date, attaches
//  the fights and fires settlement for anything it decides.
//
//  THREE rules, learned the hard way from a real historical run:
//
//  1. SEARCH IS LOOSE. Five ordered strategies per target, because a synthetic
//     "Boxing — 26 Jul 2026" card cannot be found by its own name.
//
//  2. RETRIEVAL IS SELECTIVE. Search results are scored on their TITLE before any
//     fetch (candidates.ts) and only the best few, above a threshold, are parsed.
//     The first run downloaded "List of transgender people" (1.27 MB), "Kansas City
//     Chiefs", "Back 4 Blood" and a dozen fighter biographies to learn nothing.
//     Verification made those harmless; it did not make them free.
//
//  3. ACCEPTANCE IS STRICT, AND SO IS WHAT GETS WRITTEN. A page is accepted only on
//     evidence, and only the bouts that were actually verified are persisted — never
//     the whole parsed table. Wikipedia season pages carry every card of the year;
//     attaching one of those wholesale put ~190 bouts on events that have 10.
//
//  Every decision is named and counted: which strategy won, what was rejected and
//  why, pages parsed, requests spent. A zero is always explicable.
// ════════════════════════════════════════════════════════════════════════

import PQueue from "p-queue";
import { log } from "../logger";
import { searchPages, fetchPageHtml } from "./client";
import { parseWikiCard, type WikiBout } from "./extract";
import { toNormalizedWikiEvent } from "./map";
import { verifyCard, verifyTitle, isAcceptable } from "./verify";
import { parseRecordTable, findRecordRow, recordRowToBout, DATE_TOLERANCE_DAYS, type RecordRow } from "./record-table";
import { resolveName } from "@/lib/entities/resolve";
import { rankCandidates, PARSE_BUDGET, type CandidateContext } from "./candidates";
import type { NormalizedEvent } from "@/services/providers/types";
import type { ExpectedBout } from "./verify";
import type {
  WikiTarget, WikiHarvest, WikiHarvestReport, WikiTargetOutcome, StrategyStat, TraceStep,
} from "./types";

const CONCURRENCY = Number(process.env.WIKICARD_CONCURRENCY ?? 2);
/** Candidate pages considered per search query. */
const CANDIDATES_PER_QUERY = Number(process.env.WIKICARD_CANDIDATES ?? 3);
/** Rejections kept per target for the report. Enough to explain, not to bloat. */
const MAX_REJECT_DETAIL = 8;

/**
 * Run-scoped page cache: title → parsed bouts.
 *
 * The single biggest waste in the first historical run. Wikipedia's
 * "2026 in Bare Knuckle Fighting Championship" is the right page for most BKFC
 * events, and it was fetched and parsed TWELVE times at 551 KB each because the
 * de-dup set was per-target. Cached across the whole harvest, that is one fetch and
 * one parse. Parsed bouts are cached rather than HTML — parseWikiCard is pure, so
 * re-running it is pure waste too.
 */
interface ParsedPage {
  /** Rows from an EVENT results table ("X def. Y"). */
  bouts: WikiBout[];
  /** Rows from a FIGHTER's career-record table ("Loss | Anthony Joshua | KO | 2 …"). */
  records: RecordRow[];
}

class PageCache {
  private readonly pages = new Map<string, ParsedPage | null>();
  fetches = 0;
  parses = 0;
  hits = 0;

  async page(title: string): Promise<ParsedPage | null> {
    const cached = this.pages.get(title);
    if (cached !== undefined) { this.hits += 1; return cached; }
    this.fetches += 1;
    const html = await fetchPageHtml(title);
    if (!html) { this.pages.set(title, null); return null; }
    this.parses += 1;
    // BOTH shapes, from one fetch. A page is either an event card or a fighter's
    // record; parsing for both costs nothing extra and means the pipeline never has
    // to fetch the same page twice to try the other reader.
    const parsed = { bouts: parseWikiCard(html), records: parseRecordTable(html) };
    this.pages.set(title, parsed);
    return parsed;
  }
}

/**
 * Find our bout in a FIGHTER'S CAREER RECORD.
 *
 * The page is one of our own fighters' biographies; their record table has a row per
 * bout. We accept a row only when its opponent resolves — through Entity Resolution,
 * against the closed set of this card's corners — to the OTHER fighter in one of our
 * expected bouts, AND the row's date matches the event. The date is what stops a
 * rematch overwriting the earlier meeting's result.
 */
function matchFromRecord(
  pageTitle: string,
  records: RecordRow[],
  expected: ExpectedBout[],
  eventDate: Date,
): WikiBout[] {
  if (!records.length) return [];
  const owner = expected
    .flatMap((b) => [b.red, b.blue])
    .find((e) => resolveName(pageTitle, [e]).ok);
  if (!owner) return [];

  const out: WikiBout[] = [];
  for (const bout of expected) {
    const isRed = bout.red.id === owner.id;
    const other = isRed ? bout.blue : bout.red;
    if ((isRed ? bout.red.id : bout.blue.id) !== owner.id) continue;

    const row = findRecordRow(records, eventDate, (name) => resolveName(name, [other]).ok);
    if (row) out.push(recordRowToBout(row, owner.name));
  }
  return out;
}

interface Attempt {
  outcome: WikiTargetOutcome;
  event: NormalizedEvent | null;
}

const emptyStat = (): StrategyStat => ({ searched: 0, candidates: 0, parsed: 0, verified: 0 });

/**
 * Walk one target's ladder. Stops at the first ACCEPTED page — so a real event
 * resolves on its title with one query, and only a synthetic card pays for depth.
 */
async function harvestTarget(
  target: WikiTarget,
  lastUpdated: string,
  cache: PageCache,
  stats: Record<string, StrategyStat>,
): Promise<Attempt> {
  const { eventIdentity, searchIdentity, expectedBouts, gap } = target;
  const outcome: WikiTargetOutcome = {
    eventId: target.eventId,
    event: eventIdentity.name,
    strategy: null, page: null, matched: 0, bouts: 0,
    queries: 0, parses: 0, rejected: 0, rejectedDetail: [], reason: "no_candidate", trace: [],
  };
  const step = (stage: TraceStep["stage"], ok: boolean, detail: string) =>
    outcome.trace.push({ stage, ok, detail });
  step("target", true, `${eventIdentity.name} (${eventIdentity.date.slice(0, 10)}) gap=${gap}`);
  for (const b of expectedBouts) step("target", true, `  expects: ${b.red.name} vs ${b.blue.name}`);

  const ctx: CandidateContext = {
    eventName: eventIdentity.name,
    promotionName: target.promotionName,
    promotionAliases: target.promotionAliases,
    eventYear: eventIdentity.date.slice(0, 4),
    expectedBouts,
  };

  const tried = new Set<string>();
  let sawCandidate = false;
  let sawCard = false;
  let parses = 0; // the per-target parse budget

  for (const strategy of searchIdentity) {
    if (parses >= PARSE_BUDGET) {
      outcome.note = "parse budget exhausted";
      step("budget", false, `parse budget ${PARSE_BUDGET} exhausted — stopping`);
      break;
    }
    const stat = (stats[strategy.kind] ??= emptyStat());
    stat.searched += 1;

    let titles: string[];
    try {
      outcome.queries += 1;
      titles = await searchPages(strategy.query, CANDIDATES_PER_QUERY);
    } catch (e) {
      outcome.reason = "error";
      outcome.note = `${strategy.kind}: ${(e as Error).message}`;
      step("search", false, `${strategy.kind} "${strategy.query}" — ERROR ${(e as Error).message}`);
      return { outcome, event: null };
    }
    step("search", titles.length > 0, `${strategy.kind} "${strategy.query}" → ${titles.length} result(s)`);
    if (titles.length) { sawCandidate = true; stat.candidates += titles.length; }

    // SCORE BEFORE FETCHING. This is where the wasted megabytes are refused.
    const fresh = titles.filter((t) => !tried.has(t));
    const { parse, rejected } = rankCandidates(fresh, ctx, { budget: PARSE_BUDGET - parses });
    outcome.rejected += rejected.length;
    // Rejections are recorded on the OUTCOME, not logged one by one. There are many
    // per target and the cron would drown in them; the repair report is where
    // "rejected X, score N, because …" is actually read. Capped so a pathological
    // target can't grow the report without bound.
    for (const r of rejected) {
      step("reject", false, `"${r.title}" score=${r.score} — ${r.reasons.join(",") || "no positive signal"}`);
      if (outcome.rejectedDetail.length >= MAX_REJECT_DETAIL) continue;
      outcome.rejectedDetail.push({ title: r.title, score: r.score, reasons: r.reasons });
    }
    for (const c of parse) step("candidate", true, `"${c.title}" score=${c.score} — ${c.reasons.join(",")}`);

    for (const cand of parse) {
      if (parses >= PARSE_BUDGET) break;
      tried.add(cand.title);
      parses += 1;
      outcome.parses += 1;
      stat.parsed += 1;

      let page: ParsedPage | null;
      try {
        page = await cache.page(cand.title);
      } catch (e) {
        outcome.note = `${cand.title}: ${(e as Error).message}`;
        step("fetch", false, `"${cand.title}" — ERROR ${(e as Error).message}`);
        continue;
      }
      if (!page) { step("fetch", false, `"${cand.title}" — page not found`); continue; }
      step("fetch", true, `"${cand.title}" fetched`);

      // An event page yields a card; a fighter's page yields their record. Try the
      // card first, then fall back to the record — which is the ONLY source for the
      // long tail of bouts that never get an article of their own.
      let bouts = page.bouts;
      let fromRecord = false;
      if (gap === "missing_result") {
        const viaRecord = matchFromRecord(cand.title, page.records, expectedBouts, new Date(eventIdentity.date));
        if (viaRecord.length && !verifyCard(page.bouts, expectedBouts).matched) {
          bouts = viaRecord;
          fromRecord = true;
        }
      }
      // Always report BOTH readers. Saying only "0 bout rows from the page card" on a
      // biography hides the question that matters — was the record table read, and did
      // it simply not contain this bout?
      step("parse", bouts.length > 0,
        `card rows=${page.bouts.length} · record rows=${page.records.length}` +
          (fromRecord ? ` → matched ${bouts.length} via career record` : ""));
      if (!bouts.length) {
        if (page.records.length && !fromRecord) {
          const near = page.records.filter(
            (r) => r.date && Math.abs(r.date.getTime() - new Date(eventIdentity.date).getTime()) <= DATE_TOLERANCE_DAYS * 86_400_000,
          );
          step("verify", false,
            near.length
              ? `record has ${near.length} row(s) near ${eventIdentity.date.slice(0, 10)} but the opponent is not our fighter: ${near.map((r) => r.opponent).join(", ")}`
              : `record has no row within ${DATE_TOLERANCE_DAYS} days of ${eventIdentity.date.slice(0, 10)} — this bout is not on it yet`);
        }
        continue;
      }
      sawCard = true;

      // ── THE GATE ──────────────────────────────────────────────────────────
      // A result-gap target is accepted on CONTENT and persists only the bouts that
      // verified. A card-gap target has nothing to verify against (no bouts exist
      // yet), so its title must carry the proof — safe because that gap's query IS
      // the event title — and the whole parsed card is then legitimately its own.
      let accept = false;
      let persist: WikiBout[] = [];
      let matched = 0;

      if (gap === "missing_card") {
        accept = verifyTitle(eventIdentity.name, cand.title);
        persist = bouts;
        matched = bouts.length;
      } else {
        const match = verifyCard(bouts, expectedBouts);
        accept = isAcceptable(match);
        persist = match.bouts; // verified bouts ONLY — never a season page's superset
        matched = match.matched;
      }
      if (!accept || !persist.length) {
        step("verify", false,
          gap === "missing_card"
            ? `title does not match "${eventIdentity.name}" — refused`
            : `none of the ${bouts.length} bout(s) on this page is one we are looking for`);
        continue;
      }
      step("verify", true, `${matched} of our bout(s) found on this page`);
      for (const b of persist) {
        step("result", b.decided, b.decided
          ? `${b.redName} def. ${b.blueName}${b.method ? ` by ${b.method}` : ""}${b.round ? ` R${b.round}` : ""}`
          : `${b.redName} vs ${b.blueName} — page shows NO result yet`);
      }

      stat.verified += 1;
      outcome.strategy = strategy.kind;
      outcome.page = cand.title;
      outcome.score = cand.score;
      outcome.reasons = cand.reasons;
      outcome.matched = matched;
      outcome.bouts = persist.length;
      outcome.parsedOnPage = bouts.length;
      outcome.reason = "verified";
      step("accept", true, `"${cand.title}" via ${strategy.kind} — persisting ${persist.length} bout(s)`);
      log.info(
        { op: "wikicard.accept", event: eventIdentity.name, page: cand.title, score: cand.score,
          reasons: cand.reasons, strategy: strategy.kind, matched, persisted: persist.length, onPage: bouts.length },
        "candidate accepted",
      );
      return { outcome, event: toNormalizedWikiEvent(eventIdentity, cand.title, persist, lastUpdated) };
    }
  }

  // Name the failure precisely — each of these points somewhere different:
  //   no_candidate   the search returned nothing at all
  //   all_rejected   candidates came back but none scored high enough to read
  //                  (the search ladder is finding junk — fix the query)
  //   no_card        we parsed pages but none contained a readable results table
  //   unverified     we parsed a card but it wasn't our bout (the source has no
  //                  coverage of this fight — nothing to fix)
  step("result", false, `gave up after ${outcome.queries} search(es) and ${outcome.parses} parse(s)`);
  outcome.reason = sawCard
    ? "unverified"
    : outcome.parses > 0
      ? "no_card"
      : sawCandidate
        ? "all_rejected"
        : "no_candidate";
  return { outcome, event: null };
}

/** Find + extract a verified Wikipedia card for each target. */
export async function syncWikiCards(targets: WikiTarget[]): Promise<WikiHarvest> {
  const startedAt = new Date();
  const lastUpdated = startedAt.toISOString();
  const warnings: string[] = [];
  const outcomes: WikiTargetOutcome[] = [];
  const byStrategy: Record<string, StrategyStat> = {};
  const cache = new PageCache();
  const report: WikiHarvestReport = {
    startedAt: lastUpdated, finishedAt: lastUpdated, durationMs: 0,
    targets: targets.length, matched: 0, withCard: 0, bouts: 0,
    queries: 0, parses: 0, rejected: 0, cacheHits: 0,
    byStrategy, outcomes, warnings,
  };

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const events: NormalizedEvent[] = [];

  await Promise.all(
    targets.map((target) =>
      queue.add(async () => {
        try {
          const { outcome, event } = await harvestTarget(target, lastUpdated, cache, byStrategy);
          outcomes.push(outcome);
          report.queries += outcome.queries;
          report.parses += outcome.parses;
          report.rejected += outcome.rejected;
          if (outcome.reason !== "no_candidate") report.matched += 1;
          if (event) {
            report.withCard += 1;
            report.bouts += outcome.bouts;
            events.push(event);
          }
          if (outcome.note) warnings.push(`${outcome.event}: ${outcome.note}`);
        } catch (e) {
          outcomes.push({
            eventId: target.eventId,
            event: target.eventIdentity.name, strategy: null, page: null,
            matched: 0, bouts: 0, queries: 0, parses: 0, rejected: 0, rejectedDetail: [],
            reason: "error", note: (e as Error).message, trace: [],
          });
          warnings.push(`${target.eventIdentity.name}: ${(e as Error).message}`);
        }
      }),
    ),
  );
  await queue.onIdle();

  report.cacheHits = cache.hits;
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  log.info(
    {
      targets: report.targets, verified: report.withCard, bouts: report.bouts,
      queries: report.queries, parses: report.parses, rejected: report.rejected,
      pageFetches: cache.fetches, cacheHits: cache.hits, byStrategy,
    },
    "wikicard:harvest:done",
  );
  return { report, events };
}
