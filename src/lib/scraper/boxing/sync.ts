// ════════════════════════════════════════════════════════════════════════════
//  Boxing provider. A PURE DATA PROVIDER: it never persists.
//
//  Pipeline, in the shape every provider here uses:
//
//    discover()  category membership          -> discover.ts
//    fetch()     the card's own article       -> wikiPage (shared honest client)
//    extract()   infobox + results table      -> pageMeta + parseWikiCard
//    normalize() date/venue/promotion         -> below
//    validate()  the quality gates            -> below
//    map()       bout rows -> fight stubs     -> toFightStub
//    emit()      NormalizedEvent[]            -> returned to the caller
//
//  It owns NO Prisma, no dedupe, no retries, no scheduling and no metrics. The
//  shared ingestion framework owns those: fetchPage throttles and retries behind
//  the ENABLE_SCRAPER gate, persistAggregated writes and resolves identity, and
//  the persist chokepoint normalizes text and canonicalizes for matching.
//
//  RESUMABLE, like the index and year paths: the caller passes the article
//  titles already ingested and those are skipped before a request is spent.
// ════════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub } from "@/services/providers/types";
import { log } from "../logger";
import { parseWikiCard } from "../wikicard/extract";
import { toFightStub } from "../wikicard/map";
import { wikiPage, pageMeta } from "../tournament/wiki";
import { MAX_CARD_BOUTS } from "../promotion-index/sync";
import { isRealBout } from "@/lib/entities/placeholder";
import { normalizeText } from "@/lib/text/entities";
import { categoryMembers, isCardArticle } from "./discover";
import { categoryTitle, type CategorySource } from "./config";

/** Distinct from "wikipedia", "wikipedia-index" and "wikipedia-year". */
export const BOXING_SOURCE = "wikipedia-category";

/**
 * Lower than the index path's 0.75.
 *
 * A category member is a card article Wikipedia FILED under a year, not a row
 * an index asserted belongs to a promotion. The bouts are as trustworthy; the
 * event's attribution is weaker, because a per-fight article rarely names the
 * promoter. Confidence is about how much a later, better source may overwrite.
 */
export const BOXING_CONFIDENCE = 0.7;

export type BoxingUnusableReason =
  | "not a single card"
  | "article not found"
  | "no date in the infobox"
  | "no results table"
  | "implausible bout count - looks like a season page"
  | "every bout has an unnamed corner";

export interface BoxingSyncOpts {
  sources: CategorySource[];
  years: number[];
  /** Card articles already ingested — skipped without a request. */
  skipArticles?: Set<string>;
  /** Cap on card articles fetched this run, so a long backfill is resumable. */
  maxCards?: number;
  onProgress?: (line: string) => void;
  /** Injectable for network-free tests. */
  fetchArticle?: (title: string) => Promise<{ title: string; html: string } | null>;
  /** Injectable for network-free tests. */
  listCategory?: (category: string) => Promise<string[]>;
}

export interface BoxingReport {
  categoriesRead: number;
  discovered: number;
  cardsFetched: number;
  cardsSkipped: number;
  bouts: number;
  unusable: { name: string; why: BoxingUnusableReason }[];
  warnings: string[];
}

export interface BoxingHarvest {
  events: NormalizedEvent[];
  report: BoxingReport;
}

const err = (e: unknown): string => (e as Error)?.message ?? String(e);

/**
 * The promoter, when the infobox names one.
 *
 * Boxing cards are routinely co-promoted and a per-fight article often names
 * none at all, so this returns null rather than guessing. persist stores null
 * as an unattributed event, which the promotion resolver already renders with a
 * neutral mark — an honest gap, not a wrong org.
 */
function promotionFrom(html: string, fallback: string | null): string | null {
  const m = /<th[^>]*>\s*Promoter?\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (!m) return fallback;
  const text = normalizeText(m[1].replace(/<[^>]+>/g, " ").replace(/\[\w+\]/g, ""));
  // Several promoters listed: co-promotion. Storing the first would credit one
  // and erase the others, so the card stays unattributed.
  if (!text || /[,/]|\band\b/i.test(text)) return fallback;
  return text.slice(0, 80);
}

function buildEvent(
  article: string,
  source: CategorySource,
  meta: ReturnType<typeof pageMeta>,
  promotion: string | null,
  fights: NormalizedFightStub[],
  now: Date,
): NormalizedEvent {
  // Keyed on the ARTICLE, so a rerun updates the same card rather than adding
  // one, and two categories listing the same fight converge on one event.
  const externalId = `wp-cat:${article}`;
  return {
    externalId,
    name: article,
    sport: source.sport,
    promotion: promotion ?? undefined,
    venue: meta.venue ?? undefined,
    city: meta.city ?? undefined,
    country: meta.country ?? undefined,
    date: meta.date!,
    status: new Date(meta.date!) < now ? "COMPLETED" : "SCHEDULED",
    fights,
    _meta: {
      source: BOXING_SOURCE,
      confidence: BOXING_CONFIDENCE,
      lastUpdated: now.toISOString(),
      externalId,
    },
  };
}

export async function syncBoxing(opts: BoxingSyncOpts): Promise<BoxingHarvest> {
  const say = opts.onProgress ?? (() => {});
  const fetchArticle = opts.fetchArticle ?? wikiPage;
  const listCategory = opts.listCategory ?? categoryMembers;
  const skip = opts.skipArticles ?? new Set<string>();
  const maxCards = opts.maxCards ?? Number.POSITIVE_INFINITY;
  const now = new Date();

  const events: NormalizedEvent[] = [];
  const report: BoxingReport = {
    categoriesRead: 0, discovered: 0, cardsFetched: 0, cardsSkipped: 0,
    bouts: 0, unusable: [], warnings: [],
  };

  // One article can sit in several years' categories (a card announced in one
  // year and fought in the next). Discovered once, fetched once.
  const seen = new Set<string>();

  for (const source of opts.sources) {
    for (const year of opts.years) {
      if (report.cardsFetched >= maxCards) break;
      const category = categoryTitle(source, year);

      let members: string[] = [];
      try {
        members = await listCategory(category);
        report.categoriesRead += 1;
      } catch (e) {
        report.warnings.push(`${category}: ${err(e)}`);
        say(`  !  ${category} - ${err(e)}`);
        continue;
      }
      say(`  ok  ${category} - ${members.length} article(s)`);

      for (const article of members) {
        if (report.cardsFetched >= maxCards) break;
        if (seen.has(article)) continue;
        seen.add(article);
        report.discovered += 1;

        // ── validate(), before spending a request ────────────────────────────
        if (!isCardArticle(article)) {
          report.unusable.push({ name: article, why: "not a single card" });
          continue;
        }
        if (skip.has(article)) { report.cardsSkipped += 1; continue; }

        let page: { title: string; html: string } | null = null;
        try {
          page = await fetchArticle(article);
          report.cardsFetched += 1;
        } catch (e) {
          report.warnings.push(`${article}: ${err(e)}`);
          continue;
        }
        if (!page) { report.unusable.push({ name: article, why: "article not found" }); continue; }

        // ── extract() ───────────────────────────────────────────────────────
        const meta = pageMeta(page.html);
        // A card with no date cannot be stored on one, and inventing a date is
        // worse than skipping the card.
        if (!meta.date) {
          report.unusable.push({ name: article, why: "no date in the infobox" });
          continue;
        }

        const bouts = parseWikiCard(page.html);
        if (bouts.length === 0) {
          report.unusable.push({ name: article, why: "no results table" });
          continue;
        }
        // The season-page guard the index path learned the hard way: a page
        // claiming more bouts than any card runs is a round-up, and attaching
        // them all to one event is silent, plausible-looking corruption.
        if (bouts.length > MAX_CARD_BOUTS) {
          report.unusable.push({ name: article, why: "implausible bout count - looks like a season page" });
          continue;
        }

        // ── map() ───────────────────────────────────────────────────────────
        const fights = bouts
          .map((b, i) => toFightStub(b, i))
          .filter((f) => isRealBout(f.redName, f.blueName));

        if (fights.length === 0) {
          report.unusable.push({ name: article, why: "every bout has an unnamed corner" });
          continue;
        }

        const promotion = promotionFrom(page.html, source.promotion);
        events.push(buildEvent(page.title, source, meta, promotion, fights, now));
        report.bouts += fights.length;
        say(`      ${page.title} - ${fights.length} bout(s)`);
      }
    }
  }

  log.info(
    {
      categories: report.categoriesRead, discovered: report.discovered,
      cards: events.length, bouts: report.bouts, unusable: report.unusable.length,
    },
    "boxing:sync:done",
  );
  return { events, report };
}
