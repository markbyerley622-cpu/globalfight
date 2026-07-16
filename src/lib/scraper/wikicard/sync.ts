// ════════════════════════════════════════════════════════════════════════
//  Wikipedia card provider — `syncWikiCards()`.
//
//  PURE provider: takes a list of event targets (name/date/sport), finds each
//  one's Wikipedia page, extracts the results table, and returns canonical
//  NormalizedEvent[] carrying the card. The caller (runner/script) hands them
//  to persistAggregated, which resolves the event by name+date and attaches the
//  fights. Promotion-agnostic — works for ONE, BKFC, PFL, UFC, …
//
//  Limitation: only events that HAVE a Wikipedia page get a card. Upcoming
//  events usually don't have one until close to (or after) the event.
// ════════════════════════════════════════════════════════════════════════

import PQueue from "p-queue";
import { log } from "../logger";
import { searchPages, fetchPageHtml } from "./client";
import { parseWikiCard } from "./extract";
import { toNormalizedWikiEvent } from "./map";
import type { NormalizedEvent } from "@/services/providers/types";
import type { WikiTarget, WikiHarvest, WikiHarvestReport } from "./types";

const CONCURRENCY = Number(process.env.WIKICARD_CONCURRENCY ?? 2);

/** Does this page title plausibly describe the event we asked for? */
function titleMatches(target: string, candidate: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const t = norm(target);
  const c = norm(candidate);
  if (c === t) return true;
  // "ONE Fight Night 39" ⊂ "ONE Fight Night 39: Superlek vs Takeru" and vice-versa.
  return t.startsWith(c) || c.startsWith(t);
}

/** Find + extract the Wikipedia card for each target event. */
export async function syncWikiCards(targets: WikiTarget[]): Promise<WikiHarvest> {
  const startedAt = new Date();
  const lastUpdated = startedAt.toISOString();
  const warnings: string[] = [];
  const report: WikiHarvestReport = {
    startedAt: lastUpdated, finishedAt: lastUpdated, durationMs: 0,
    targets: targets.length, matched: 0, withCard: 0, bouts: 0, warnings,
  };

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const events: NormalizedEvent[] = [];

  await Promise.all(
    targets.map((target) =>
      queue.add(async () => {
        try {
          const candidates = await searchPages(target.name, 3);
          const title = candidates.find((c) => titleMatches(target.name, c));
          if (!title) return; // no plausible page — leave the event as-is
          report.matched += 1;

          const html = await fetchPageHtml(title);
          if (!html) return;
          const bouts = parseWikiCard(html);
          if (!bouts.length) return;

          report.withCard += 1;
          report.bouts += bouts.length;
          events.push(toNormalizedWikiEvent(target, title, bouts, lastUpdated));
        } catch (e) {
          warnings.push(`${target.name}: ${(e as Error).message}`);
        }
      }),
    ),
  );
  await queue.onIdle();

  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  log.info(
    { targets: report.targets, matched: report.matched, withCard: report.withCard, bouts: report.bouts },
    "wikicard:harvest:done",
  );
  return { report, events };
}
