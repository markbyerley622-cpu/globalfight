// ════════════════════════════════════════════════════════════════════════
//  Wikipedia card provider — `syncWikiCards()`.
//
//  PURE provider: takes a list of event targets, walks each one's SEARCH LADDER
//  until a candidate page VERIFIES against the bouts we are missing, and returns
//  canonical NormalizedEvent[] carrying the card. The caller (runner/script) hands
//  them to persistAggregated, which resolves the event by name+date and attaches
//  the fights. Promotion-agnostic — works for ONE, BKFC, PFL, UFC, and for the
//  synthetic daily cards the odds pipeline invents.
//
//  Two rules make the widened search safe:
//
//    SEARCH IS LOOSE     — five ordered strategies per target (event title, the
//                          bout, promotion+event, bare fighter names, registry
//                          aliases), because a synthetic card's own name cannot be
//                          found upstream and a real card's sometimes can't either.
//
//    ACCEPTANCE IS STRICT — a page is only accepted when its parsed card actually
//                          contains a bout between the two fighters we came for,
//                          compared through Entity Resolution (verify.ts). Never a
//                          title-prefix guess. A page we cannot verify is skipped,
//                          because an unresolved bout is honest and a wrong result
//                          is not.
//
//  Every target's outcome is named and reported (verified / no_candidate / no_card /
//  unverified / error) along with which strategy won, so a zero is always explicable.
// ════════════════════════════════════════════════════════════════════════

import PQueue from "p-queue";
import { log } from "../logger";
import { searchPages, fetchPageHtml } from "./client";
import { parseWikiCard } from "./extract";
import { toNormalizedWikiEvent } from "./map";
import { verifyCard, isAcceptable } from "./verify";
import type { NormalizedEvent } from "@/services/providers/types";
import type { WikiTarget, WikiHarvest, WikiHarvestReport, WikiTargetOutcome } from "./types";

const CONCURRENCY = Number(process.env.WIKICARD_CONCURRENCY ?? 2);
/** Candidate pages considered per search query. */
const CANDIDATES_PER_QUERY = Number(process.env.WIKICARD_CANDIDATES ?? 3);

interface Attempt {
  outcome: WikiTargetOutcome;
  event: NormalizedEvent | null;
}

/**
 * Walk one target's ladder. Stops at the first VERIFIED page — so a real event
 * resolves on its title with a single query, and only a synthetic card pays for the
 * deeper strategies.
 */
async function harvestTarget(target: WikiTarget, lastUpdated: string): Promise<Attempt> {
  const { eventIdentity, searchIdentity, expectedBouts } = target;
  const outcome: WikiTargetOutcome = {
    event: eventIdentity.name,
    strategy: null,
    page: null,
    matched: 0,
    bouts: 0,
    queries: 0,
    reason: "no_candidate",
  };

  // Pages already fetched for THIS target: different strategies routinely surface
  // the same article, and parsing it twice is a wasted request either way.
  const tried = new Set<string>();
  let sawCandidate = false;
  let sawCard = false;

  for (const strategy of searchIdentity) {
    let titles: string[];
    try {
      outcome.queries += 1;
      titles = await searchPages(strategy.query, CANDIDATES_PER_QUERY);
    } catch (e) {
      outcome.reason = "error";
      outcome.note = `${strategy.kind}: ${(e as Error).message}`;
      return { outcome, event: null };
    }
    if (titles.length) sawCandidate = true;

    for (const title of titles) {
      if (tried.has(title)) continue;
      tried.add(title);

      let html: string | null;
      try {
        outcome.queries += 1;
        html = await fetchPageHtml(title);
      } catch (e) {
        outcome.note = `${title}: ${(e as Error).message}`;
        continue;
      }
      if (!html) continue;

      const bouts = parseWikiCard(html);
      if (!bouts.length) continue;
      sawCard = true;

      // THE gate. Content, not title.
      const match = verifyCard(bouts, expectedBouts);
      if (!isAcceptable(match)) continue;

      outcome.strategy = strategy.kind;
      outcome.page = title;
      outcome.matched = match.matched;
      outcome.bouts = bouts.length;
      outcome.reason = "verified";
      return {
        outcome,
        event: toNormalizedWikiEvent(eventIdentity, title, bouts, lastUpdated),
      };
    }
  }

  // Nothing verified. Say WHICH kind of nothing — the three cases need different
  // responses and lumping them together is how "written=0" became uninterpretable.
  outcome.reason = sawCard ? "unverified" : sawCandidate ? "no_card" : "no_candidate";
  return { outcome, event: null };
}

/** Find + extract a verified Wikipedia card for each target. */
export async function syncWikiCards(targets: WikiTarget[]): Promise<WikiHarvest> {
  const startedAt = new Date();
  const lastUpdated = startedAt.toISOString();
  const warnings: string[] = [];
  const outcomes: WikiTargetOutcome[] = [];
  const report: WikiHarvestReport = {
    startedAt: lastUpdated, finishedAt: lastUpdated, durationMs: 0,
    targets: targets.length, matched: 0, withCard: 0, bouts: 0,
    queries: 0, byStrategy: {}, outcomes, warnings,
  };

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const events: NormalizedEvent[] = [];

  await Promise.all(
    targets.map((target) =>
      queue.add(async () => {
        try {
          const { outcome, event } = await harvestTarget(target, lastUpdated);
          outcomes.push(outcome);
          report.queries += outcome.queries;
          if (outcome.reason !== "no_candidate") report.matched += 1;
          if (event) {
            report.withCard += 1;
            report.bouts += outcome.bouts;
            if (outcome.strategy) {
              report.byStrategy[outcome.strategy] = (report.byStrategy[outcome.strategy] ?? 0) + 1;
            }
            events.push(event);
          }
          if (outcome.note) warnings.push(`${outcome.event}: ${outcome.note}`);
        } catch (e) {
          outcomes.push({
            event: target.eventIdentity.name, strategy: null, page: null,
            matched: 0, bouts: 0, queries: 0, reason: "error", note: (e as Error).message,
          });
          warnings.push(`${target.eventIdentity.name}: ${(e as Error).message}`);
        }
      }),
    ),
  );
  await queue.onIdle();

  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  log.info(
    {
      targets: report.targets, matched: report.matched, withCard: report.withCard,
      bouts: report.bouts, queries: report.queries, byStrategy: report.byStrategy,
    },
    "wikicard:harvest:done",
  );
  return { report, events };
}
