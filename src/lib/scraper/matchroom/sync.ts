// ════════════════════════════════════════════════════════════════════════════
//  Matchroom Boxing — FORWARD schedule provider. Pure: it never persists.
//
//    discover()  events sitemap                -> below
//    fetch()     the event page                -> shared honest client
//    extract()   DOM -> card                   -> ./extract
//    validate()  date, real corners, size      -> below
//    map()       -> NormalizedEvent            -> below
//    emit()      -> returned to the caller     -> the caller persists
//
//  Owns no Prisma, no dedupe, no retries, no scheduling. Same contract as every
//  other provider here.
//
//  UPCOMING-ONLY BY DEFAULT, and that is the point. The archive is already
//  strong — Wikipedia gave boxing 149 events and 1,157 bouts — and it is the
//  SCHEDULE that predictions, reminders and every retention loop consume.
//  Re-scraping history from a source that publishes less of it would spend
//  hundreds of requests to add nothing.
// ════════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub } from "@/services/providers/types";
import { fetchPage } from "../http";
import { log } from "../logger";
import { slugify } from "@/lib/utils";
import { isRealBout } from "@/lib/entities/placeholder";
import { normalizeText } from "@/lib/text/entities";
import { RULESET_CONFIDENCE } from "../ruleset";
import { parseMatchroomEvent, type MatchroomCard } from "./extract";

export const MATCHROOM_SOURCE = "matchroom";
/** The promoter's own schedule. Authoritative for a date, venue and card. */
export const MATCHROOM_CONFIDENCE = 0.9;

const SITEMAP_URL = process.env.MATCHROOM_SITEMAP_URL ?? "https://www.matchroomboxing.com/events-sitemap.xml";

/** A card claiming more than this is a listing page, not one night of boxing. */
const MAX_CARD_BOUTS = 25;

export type MatchroomUnusable =
  | "not an event page"
  | "no date on the page"
  | "already past"
  | "no bouts listed"
  | "implausible bout count"
  | "every bout has an unnamed corner";

export interface MatchroomReport {
  discovered: number;
  fetched: number;
  skipped: number;
  bouts: number;
  unusable: { url: string; why: MatchroomUnusable }[];
  warnings: string[];
}

export interface MatchroomSyncOpts {
  /** Include past cards too. Off by default — see the note above. */
  includePast?: boolean;
  /** Cap the run, so a first pass is resumable. */
  maxEvents?: number;
  /** Event URLs already ingested — skipped without a request. */
  skipUrls?: Set<string>;
  onProgress?: (line: string) => void;
  /** Injectable for network-free tests. */
  fetchEvent?: (url: string) => Promise<string | null>;
  listEvents?: () => Promise<string[]>;
}

const err = (e: unknown): string => (e as Error)?.message ?? String(e);

/**
 * Every /events/ URL in the sitemap, NEWEST FIRST.
 *
 * The order is load-bearing, not cosmetic. Matchroom's sitemap is written
 * oldest-first and the first ~250 entries are 2021-era cards whose template
 * predates the current one — no `.event-title`, so they parse to nothing. A run
 * bounded by `maxEvents` therefore spent its entire budget on pages it could
 * not read and returned zero cards, while the upcoming fixtures it was for sat
 * at the far end of the file.
 *
 * Sorting by `lastmod` descending puts the live and upcoming cards first, so a
 * bounded run reaches the schedule it exists to collect.
 */
export async function discoverEvents(): Promise<string[]> {
  const { html } = await fetchPage(SITEMAP_URL);

  const entries: { url: string; lastmod: string }[] = [];
  for (const m of html.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = m[1];
    const url = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(block)?.[1]?.trim();
    if (!url || !/\/events\//.test(url)) continue;
    entries.push({ url, lastmod: /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(block)?.[1]?.trim() ?? "" });
  }

  entries.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
  return [...new Set(entries.map((e) => e.url))];
}

function toEvent(url: string, card: MatchroomCard, now: Date): NormalizedEvent {
  const fights: NormalizedFightStub[] = card.bouts
    .filter((b) => isRealBout(b.redName, b.blueName))
    .map((b, i) => ({
      redName: b.redName,
      blueName: b.blueName,
      redExternalId: slugify(b.redName),
      blueExternalId: slugify(b.blueName),
      titleFight: b.titleFight,
      mainEvent: i === 0, // the page lists the headline first
      result: "SCHEDULED" as const,
      // Matchroom promotes boxing and only boxing, so the ruleset is a fact
      // about the promoter rather than an inference from the card.
      ruleset: "BOXING" as const,
      rulesetConfidence: RULESET_CONFIDENCE.singleRulesetPromotion,
      rulesetSource: MATCHROOM_SOURCE,
    }));

  const externalId = `matchroom:${url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "")}`;
  return {
    externalId,
    name: normalizeText(card.name),
    sport: "BOXING",
    promotion: "Matchroom Boxing",
    venue: card.venue ?? undefined,
    broadcaster: card.broadcaster ?? undefined,
    ticketUrl: card.ticketUrl ?? undefined,
    eventUrl: url,
    date: card.date!,
    status: new Date(card.date!) < now ? "COMPLETED" : "SCHEDULED",
    fights,
    _meta: {
      source: MATCHROOM_SOURCE,
      confidence: MATCHROOM_CONFIDENCE,
      lastUpdated: now.toISOString(),
      externalId,
    },
  } as NormalizedEvent;
}

export async function syncMatchroom(
  opts: MatchroomSyncOpts = {},
): Promise<{ events: NormalizedEvent[]; report: MatchroomReport }> {
  const say = opts.onProgress ?? (() => {});
  const list = opts.listEvents ?? discoverEvents;
  const fetchEvent =
    opts.fetchEvent ?? (async (u: string) => (await fetchPage(u)).html);
  const skip = opts.skipUrls ?? new Set<string>();
  const max = opts.maxEvents ?? Number.POSITIVE_INFINITY;
  const now = new Date();

  const events: NormalizedEvent[] = [];
  const report: MatchroomReport = {
    discovered: 0, fetched: 0, skipped: 0, bouts: 0, unusable: [], warnings: [],
  };

  let urls: string[] = [];
  try {
    urls = await list();
    report.discovered = urls.length;
  } catch (e) {
    report.warnings.push(`sitemap: ${err(e)}`);
    return { events, report };
  }
  say(`  ok  sitemap — ${urls.length} event URL(s)`);

  for (const url of urls) {
    if (report.fetched >= max) break;
    if (skip.has(url)) { report.skipped += 1; continue; }

    let html: string | null = null;
    try {
      html = await fetchEvent(url);
      report.fetched += 1;
    } catch (e) {
      report.warnings.push(`${url}: ${err(e)}`);
      continue;
    }
    if (!html) { report.unusable.push({ url, why: "not an event page" }); continue; }

    const card = parseMatchroomEvent(html);
    if (!card) { report.unusable.push({ url, why: "not an event page" }); continue; }
    // A card with no date cannot be stored on one, and inventing one is worse.
    if (!card.date) { report.unusable.push({ url, why: "no date on the page" }); continue; }
    if (!opts.includePast && new Date(card.date) < now) {
      report.unusable.push({ url, why: "already past" });
      continue;
    }
    if (card.bouts.length === 0) { report.unusable.push({ url, why: "no bouts listed" }); continue; }
    if (card.bouts.length > MAX_CARD_BOUTS) {
      report.unusable.push({ url, why: "implausible bout count" });
      continue;
    }

    const ev = toEvent(url, card, now);
    const fightCount = ev.fights?.length ?? 0;
    if (fightCount === 0) {
      report.unusable.push({ url, why: "every bout has an unnamed corner" });
      continue;
    }
    events.push(ev);
    report.bouts += fightCount;
    say(`      ${card.name} — ${card.date.slice(0, 10)} — ${fightCount} bout(s)`);
  }

  log.info(
    { discovered: report.discovered, fetched: report.fetched, cards: events.length, bouts: report.bouts },
    "matchroom:sync:done",
  );
  return { events, report };
}
