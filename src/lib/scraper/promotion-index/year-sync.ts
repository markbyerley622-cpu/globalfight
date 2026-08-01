// ════════════════════════════════════════════════════════════════════════════
//  Year round-ups -> cards. A PURE DATA PROVIDER: it never persists.
//
//  One request per YEAR, not per card — a season of ~50 ONE cards costs a single
//  fetch. Bouts come from the existing wikicard extractor via year-split.ts;
//  there is no second card parser here.
//
//  THE NAMING PROBLEM THIS SOLVES
//
//  persistAggregated identifies an event by slugify(name). Our ONE rows were
//  written by other providers and are named for the BILLING:
//
//      ours   "ONE Friday Fights 164 & The Inner Circle 24"
//      theirs "ONE Friday Fights 164: Pompet vs. Nat Khat Min"
//
//  Emitting the upstream name would slug differently and create a SECOND event
//  instead of filling the empty one we already have — turning a 382-empty-card
//  problem into a 764-card problem, silently, with both copies looking fine.
//
//  So a section is emitted under the name WE already store whenever we can
//  identify the row it belongs to. That lookup needs the database, and this
//  module is pure, so the caller injects it as `resolveStored`. When nothing
//  matches, the card is genuinely new and the upstream name is used.
// ════════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub } from "@/services/providers/types";
import { log } from "../logger";
import { parseWikiCard } from "../wikicard/extract";
import { toFightStub } from "../wikicard/map";
import { coreEventTitle } from "../wikicard/search-strategies";
import { wikiPage } from "../tournament/wiki";
import { MAX_CARD_BOUTS } from "./sync";
import { splitYearPage, type YearPageSection } from "./year-split";
import { yearPageTitle, type YearPageSource } from "./config";

/** Distinct from "wikipedia" and "wikipedia-index": a third query wrote these. */
export const YEAR_SOURCE = "wikipedia-year";
export const YEAR_CONFIDENCE = 0.75;

/** A section, with the name reduced to its stable core for matching. */
export interface SectionKey {
  /** The name as the year page states it. */
  name: string;
  /** That name with billing/distribution stripped, for cross-source matching. */
  core: string;
  /** ISO date. */
  date: string;
}

export type ResolveStored = (key: SectionKey) => string | null;

export interface YearSyncOpts {
  sources: YearPageSource[];
  years: number[];
  /** Year pages already ingested — skipped without a request. */
  skipPages?: Set<string>;
  onProgress?: (line: string) => void;
  /** Injectable for network-free tests. */
  fetchArticle?: (title: string) => Promise<{ title: string; html: string } | null>;
  /** The name our DB already stores for this card, or null if it is new. */
  resolveStored?: ResolveStored;
}

export type YearUnusableReason =
  | "no results table before the next event"
  | "no parseable date"
  | "implausible bout count - looks like a season page";

export interface YearReport {
  pagesFetched: number;
  pagesMissing: number;
  pagesSkipped: number;
  sections: number;
  bouts: number;
  /** Sections matched to an event we ALREADY hold — these fill, not duplicate. */
  matchedExisting: number;
  /** Sections with no existing row — genuinely new cards. */
  newCards: number;
  unusable: { name: string; why: YearUnusableReason }[];
  warnings: string[];
}

export interface YearHarvest {
  events: NormalizedEvent[];
  report: YearReport;
}

const err = (e: unknown): string => (e as Error)?.message ?? String(e);

/**
 * The key on which a year-page section is matched to an event we already hold.
 *
 * Reduction alone is not enough — the two sides name the same card differently
 * even after billing is stripped:
 *
 *     ours   "ONE Friday Fights 164 & The Inner Circle 24"  -> "ONE Friday Fights 164"
 *     theirs "ONE Friday Fights 164: Pompet vs. Nat Khat Min / The Inner Circle 23"
 *                                                           -> "ONE Friday Fights 164: Pompet…"
 *
 * What both agree on is the DESIGNATION: the promotion and its card number,
 * before any headline. So the key is the reduced name cut at the first colon —
 * but ONLY when a card number survives the cut.
 *
 * That condition is load-bearing. ONE also names cards "ONE Championship: No
 * Surrender 2", where cutting at the colon leaves "ONE Championship" and every
 * such card collapses onto one key. During COVID ONE ran No Surrender 2 AND 3 on
 * the same night, so a collapsed key would match one card to the other's row and
 * write its bouts under the wrong name. Measured on 2026-08-02: 8 same-night
 * pairs in our own data would have collided this way.
 *
 * Deliberately paired with an exact date by the caller. The designation alone is
 * not unique enough to write to — "Glory 98" could be re-used across a rename —
 * and matching the wrong row would move bouts onto someone else's card.
 */
export function eventMatchKey(name: string): string {
  const core = coreEventTitle(name) ?? name;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const head = core.split(":")[0];
  // No number in the head means the head is just the promotion, and the headline
  // after the colon is the only thing that distinguishes this card. Keep it.
  return /\d/.test(head) ? norm(head) : norm(core);
}

export const sectionKey = (s: YearPageSection): SectionKey => ({
  name: s.name,
  core: coreEventTitle(s.name) ?? s.name,
  date: s.date!,
});

/** Stable per card, so a rerun skips a page it already read. */
export const yearExternalId = (article: string): string => `wp-year:${article}`;

export const pageFromExternalId = (externalId: string): string | null =>
  externalId.startsWith("wp-year:") ? externalId.slice("wp-year:".length) : null;

function buildEvent(
  section: YearPageSection,
  source: YearPageSource,
  name: string,
  fights: NormalizedFightStub[],
  now: Date,
): NormalizedEvent {
  // Per-CARD, so two cards off the same page never collide, and a rerun updates
  // rather than duplicating.
  const externalId = `wp-year:${source.key}:${section.name}`;
  return {
    externalId,
    name,
    sport: source.sport,
    promotion: source.promotion,
    venue: section.venue ?? undefined,
    city: section.city ?? undefined,
    date: section.date!,
    status: new Date(section.date!) < now ? "COMPLETED" : "SCHEDULED",
    fights,
    _meta: {
      source: YEAR_SOURCE,
      confidence: YEAR_CONFIDENCE,
      lastUpdated: now.toISOString(),
      externalId,
    },
  };
}

export async function syncYearPages(opts: YearSyncOpts): Promise<YearHarvest> {
  const say = opts.onProgress ?? (() => {});
  const fetchArticle = opts.fetchArticle ?? wikiPage;
  const resolveStored = opts.resolveStored ?? (() => null);
  const skip = opts.skipPages ?? new Set<string>();
  const now = new Date();

  const events: NormalizedEvent[] = [];
  const report: YearReport = {
    pagesFetched: 0, pagesMissing: 0, pagesSkipped: 0, sections: 0, bouts: 0,
    matchedExisting: 0, newCards: 0, unusable: [], warnings: [],
  };

  for (const source of opts.sources) {
    for (const year of opts.years) {
      if (year < source.firstYear) continue;
      const title = yearPageTitle(source, year);
      if (skip.has(title)) { report.pagesSkipped += 1; continue; }

      let page: { title: string; html: string } | null = null;
      try {
        page = await fetchArticle(title);
      } catch (e) {
        report.warnings.push(`${title}: ${err(e)}`);
        say(`  !  ${title} — ${err(e)}`);
        continue;
      }
      // A year with no round-up is a SOURCE fact, not a failure: the promotion
      // may not have run that year, or it may not be written up yet.
      if (!page) { report.pagesMissing += 1; say(`  –  ${title} — no such page`); continue; }
      report.pagesFetched += 1;

      const { sections, report: split } = splitYearPage(page.html);
      for (const s of split.skipped) report.unusable.push({ name: s.name, why: s.why as YearUnusableReason });
      say(`  ok  ${title} — ${sections.length} card(s)${split.skipped.length ? `, ${split.skipped.length} unusable` : ""}`);

      for (const section of sections) {
        const bouts = parseWikiCard(section.cardHtml);
        if (!bouts.length) continue;

        // The same season-page guard the index path uses. A section SHOULD be one
        // card; if the split produced something card-shaped but implausibly large,
        // the page's structure changed and the sectioning can no longer be trusted
        // for that entry.
        if (bouts.length > MAX_CARD_BOUTS) {
          report.unusable.push({ name: section.name, why: "implausible bout count - looks like a season page" });
          say(`     -  ${section.name} — ${bouts.length} bouts; refusing`);
          continue;
        }

        const stored = resolveStored(sectionKey(section));
        if (stored) report.matchedExisting += 1;
        else report.newCards += 1;

        const fights = bouts.map((b, i) => toFightStub(b, i, true));
        report.sections += 1;
        report.bouts += fights.length;
        events.push(buildEvent(section, source, stored ?? section.name, fights, now));

        const decided = fights.filter((f) => f.result !== "SCHEDULED").length;
        say(`     ok  ${stored ?? section.name} — ${fights.length} bouts (${decided} decided)${stored ? "  [fills existing]" : "  [new]"}`);
      }
    }
  }

  log.info(
    { events: events.length, bouts: report.bouts, matched: report.matchedExisting, fresh: report.newCards },
    "promotion-index:year:harvest:done",
  );
  return { events, report };
}
