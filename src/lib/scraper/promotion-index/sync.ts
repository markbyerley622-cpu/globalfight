// ════════════════════════════════════════════════════════════════════════
//  Promotion index -> cards. A PURE DATA PROVIDER: it never persists.
//
//  Two steps, one request each:
//    1. the promotion's index article -> every card it has ever run
//    2. each card's own article       -> its bouts, via the EXISTING wikicard
//                                       extractor (no second card parser)
//
//  RESUMABLE. The caller passes `skipArticles` - the set of card articles
//  already ingested - and this skips them before spending a request. So a run
//  interrupted at card 40 of 90 costs 40 fewer requests next time, and rerunning
//  a finished backfill costs one request for the index and nothing else.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub } from "@/services/providers/types";
import { slugify } from "@/lib/utils";
import { log } from "../logger";
import { parseWikiCard } from "../wikicard/extract";
import { toFightStub } from "../wikicard/map";
import { wikiPage } from "../tournament/wiki";
import type { PromotionIndexSource } from "./config";
import { parseEventIndex, type IndexedEvent } from "./parse";

/** Distinct from wikicard's "wikipedia": a different query wrote these rows. */
export const INDEX_SOURCE = "wikipedia-index";
export const INDEX_CONFIDENCE = 0.75;

/**
 * Most bouts one article may claim for a single card.
 *
 * A boxing card is 8-15 bouts. The number that matters is not the true maximum
 * but the point past which "this is one card" stops being credible - a year
 * round-up parsed to 63.
 */
export const MAX_CARD_BOUTS = 30;

/** Why an index row could not become a card. Each is a DIFFERENT problem. */
export type UnusableReason =
  | "no article linked"
  | "no date in the index"
  | "article not found"
  | "no results table"
  | "shared article - cannot attribute bouts to one card"
  | "implausible bout count - looks like a season page";

export interface IndexSyncOpts {
  sources: PromotionIndexSource[];
  /** Card article titles already ingested - skipped without a request. */
  skipArticles?: Set<string>;
  /** Cap on card articles fetched this run. Makes a long backfill resumable. */
  maxCards?: number;
  onProgress?: (line: string) => void;
  /**
   * Page fetcher, injectable so the over-attach guards can be tested WITHOUT
   * network. Those guards only fire after a fetch resolves a redirect, so
   * testing them at all requires being able to stand in for the fetch.
   */
  fetchArticle?: (title: string) => Promise<{ title: string; html: string } | null>;
}

export interface IndexReport {
  indexRows: number;
  cardsFetched: number;
  cardsSkipped: number;
  bouts: number;
  /**
   * Index rows we could not turn into a card, WITH the reason. Never merged:
   * "the index lists no article" is a source limit, "the article had no results
   * table" is a parser question, and they get fixed by different people.
   */
  unusable: { name: string; why: UnusableReason }[];
  warnings: string[];
}

export interface IndexHarvest {
  events: NormalizedEvent[];
  report: IndexReport;
}

const err = (e: unknown): string => (e as Error)?.message ?? String(e);

function buildEvent(
  row: IndexedEvent,
  source: PromotionIndexSource,
  article: string,
  fights: NormalizedFightStub[],
  now: Date,
): NormalizedEvent {
  const externalId = `wp-index:${article}`;
  return {
    externalId,
    name: row.name,
    sport: source.sport,
    promotion: source.promotion,
    venue: row.venue ?? undefined,
    city: row.city ?? undefined,
    country: row.country ?? undefined,
    date: row.date!,
    status: new Date(row.date!) < now ? "COMPLETED" : "SCHEDULED",
    fights,
    _meta: {
      source: INDEX_SOURCE,
      confidence: INDEX_CONFIDENCE,
      lastUpdated: now.toISOString(),
      externalId,
    },
  };
}

export async function syncPromotionIndex(opts: IndexSyncOpts): Promise<IndexHarvest> {
  const say = opts.onProgress ?? (() => {});
  const fetchArticle = opts.fetchArticle ?? wikiPage;
  const skip = opts.skipArticles ?? new Set<string>();
  const maxCards = opts.maxCards ?? Number.POSITIVE_INFINITY;
  const now = new Date();

  const events: NormalizedEvent[] = [];
  const report: IndexReport = {
    indexRows: 0, cardsFetched: 0, cardsSkipped: 0, bouts: 0, unusable: [], warnings: [],
  };

  for (const source of opts.sources) {
    let index: { title: string; html: string } | null = null;
    try {
      index = await fetchArticle(source.article);
    } catch (e) {
      report.warnings.push(`${source.article}: ${err(e)}`);
      say(`  !  ${source.article} - ${err(e)}`);
      continue;
    }
    if (!index) {
      report.warnings.push(`${source.article}: index article not found`);
      continue;
    }

    const rows = parseEventIndex(index.html);
    report.indexRows += rows.length;
    say(`  ok  ${source.promotion} index - ${rows.length} card(s) listed`);

    // ── Refuse a SHARED article ──────────────────────────────────────────────
    //
    // When several index rows link to the SAME article, that article cannot be
    // about any one of them - it is the year round-up ("2024 in Misfits
    // Boxing"), and parseWikiCard reads every results table on it. Left
    // unguarded, eight different X Series cards each claimed the same 63 bouts:
    // one real card duplicated across a season, with the wrong fighters on seven
    // of them. That is the season-page over-attach this codebase has been bitten
    // by before, and it is silent - every card looks populated.
    //
    // There is no way to split a year page back into its cards from here, so the
    // rows are refused with the reason recorded rather than guessed apart.
    const articleUse = new Map<string, number>();
    for (const r of rows) if (r.article) articleUse.set(r.article, (articleUse.get(r.article) ?? 0) + 1);

    /** Resolved page title -> the index row that claimed it first. */
    const resolvedArticles = new Map<string, string>();

    for (const row of rows) {
      if (report.cardsFetched >= maxCards) break;

      // A card with no date cannot be stored on a date, and inventing one is
      // worse than skipping it.
      if (!row.date) { report.unusable.push({ name: row.name, why: "no date in the index" }); continue; }
      if (!row.article) { report.unusable.push({ name: row.name, why: "no article linked" }); continue; }
      if ((articleUse.get(row.article) ?? 0) > 1) {
        report.unusable.push({ name: row.name, why: "shared article - cannot attribute bouts to one card" });
        continue;
      }
      if (skip.has(row.article)) { report.cardsSkipped += 1; continue; }

      let page: { title: string; html: string } | null = null;
      try {
        page = await fetchArticle(row.article);
        report.cardsFetched += 1;
      } catch (e) {
        report.warnings.push(`${row.article}: ${err(e)}`);
        continue;
      }
      if (!page) { report.unusable.push({ name: row.name, why: "article not found" }); continue; }

      // ── Dedupe on the RESOLVED title, not the link ────────────────────────
      //
      // Three different index links - the entries for X Series 001, 002 and 003 -
      // are REDIRECTS to one article. Deduping on the link title sees three
      // distinct names and lets all three through; each then claimed the same 21
      // bouts, so three separate cards carried an identical fabricated line-up.
      // The resolved title is the only thing that identifies the page we read.
      const claimedBy = resolvedArticles.get(page.title);
      if (claimedBy && claimedBy !== row.name) {
        report.unusable.push({ name: row.name, why: "shared article - cannot attribute bouts to one card" });
        say(`     -  ${row.name} - redirects to "${page.title}", already claimed by ${claimedBy}`);
        continue;
      }
      resolvedArticles.set(page.title, row.name);

      const bouts = parseWikiCard(page.html);
      if (!bouts.length) {
        // The article exists but carries no results table - an upcoming card, or
        // a stub. Recorded as its own reason, not as "no article".
        report.unusable.push({ name: row.name, why: "no results table" });
        say(`     -  ${row.name} - article has no results table`);
        continue;
      }

      // Second guard, for a season page reached by only ONE index row - which the
      // shared-article check cannot see. A boxing card is 8-15 bouts; anything
      // past MAX_CARD_BOUTS is a round-up page, not a card.
      if (bouts.length > MAX_CARD_BOUTS) {
        report.unusable.push({ name: row.name, why: "implausible bout count - looks like a season page" });
        say(`     -  ${row.name} - ${bouts.length} bouts on one article; refusing (season page)`);
        continue;
      }

      const fights = bouts.map((b, i) => toFightStub(b, i, true));
      report.bouts += fights.length;
      events.push(buildEvent(row, source, page.title, fights, now));
      const decided = fights.filter((f) => f.result !== "SCHEDULED").length;
      say(`     ok  ${row.name} - ${fights.length} bouts (${decided} decided)`);
    }
  }

  log.info({ events: events.length, bouts: report.bouts, skipped: report.cardsSkipped }, "promotion-index:harvest:done");
  return { events, report };
}

/** Card articles already ingested, for the resumable skip set. */
export const articleFromExternalId = (externalId: string): string | null =>
  externalId.startsWith("wp-index:") ? externalId.slice("wp-index:".length) : null;

export const indexSlug = (name: string): string => slugify(name);
