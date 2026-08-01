// ════════════════════════════════════════════════════════════════════════
//  Tournament harvest — hub page → division pages → bouts → NormalizedEvent[].
//
//  A PURE DATA PROVIDER, like the BKFC and ONE providers: it acquires and
//  transforms, and it does not persist, dedupe, snapshot or settle. The caller
//  hands the harvest to persistAggregated, which owns all of that.
//
//  Event granularity differs by sport, because the source's granularity does:
//
//    brackets (wrestling/taekwondo/judo) — ONE EVENT PER DIVISION. Each division
//      is its own sub-article with its own date and a 15–31 bout tree. Folding a
//      whole championship into one row would produce a 300-bout "card", which is
//      neither how anyone watches it nor something the event page can render.
//
//    medals only (sambo/BJJ) — ONE EVENT PER CHAMPIONSHIP. There is exactly one
//      derivable bout per division (the final), so a per-division event would be
//      a card of one bout. The championship, with its ~18 finals, is the card.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent } from "@/services/providers/types";
import { log } from "../logger";
import { parseBrackets } from "./bracket";
import { parseMedalFinals } from "./medals";
import type { TournamentSource } from "./config";
import { toNormalizedEvent } from "./map";
import type { TournamentBout, TournamentCard, TournamentReport } from "./types";
import { disambiguateName, pageMeta, subArticles, wikiPage } from "./wiki";

export interface TournamentSyncOpts {
  sources: TournamentSource[];
  /** Calendar years to look for, newest first. */
  years: number[];
  /** Cap on division sub-articles fetched per hub — the request budget. */
  maxDivisions?: number;
  /** Streams a line per page so a long local run isn't silent. */
  onProgress?: (line: string) => void;
}

export interface TournamentHarvest {
  events: NormalizedEvent[];
  report: TournamentReport;
}

const err = (e: unknown): string => (e as Error)?.message ?? String(e);

export async function syncTournaments(opts: TournamentSyncOpts): Promise<TournamentHarvest> {
  const maxDivisions = Math.max(1, opts.maxDivisions ?? 12);
  const say = opts.onProgress ?? (() => {});
  const events: NormalizedEvent[] = [];
  const report: TournamentReport = {
    hubsTried: 0,
    hubsFound: 0,
    divisionsFetched: 0,
    bracketBouts: 0,
    medalBouts: 0,
    skipped: [],
    warnings: [],
  };

  for (const source of opts.sources) {
    for (const year of opts.years) {
      for (const pattern of source.hubs) {
        const hubTitle = pattern.replace("{year}", String(year));
        report.hubsTried += 1;

        let hub: { title: string; html: string } | null = null;
        try {
          hub = await wikiPage(hubTitle);
        } catch (e) {
          // A refused or unreachable page is a source condition, not a crash.
          report.warnings.push(`${hubTitle}: ${err(e)}`);
          say(`  !  ${hubTitle} — ${err(e)}`);
          continue;
        }
        if (!hub) {
          report.skipped.push({ title: hubTitle, why: "no such page" });
          continue;
        }
        report.hubsFound += 1;
        const hubMeta = pageMeta(hub.html);

        if (source.medalsOnly) {
          const produced = fromMedals(source, hub, hubMeta, report);
          events.push(...produced);
          say(`  ✓  ${hub.title} — ${produced.reduce((n, e2) => n + (e2.fights?.length ?? 0), 0)} finals (derived)`);
          continue;
        }

        const divisions = subArticles(hub.html, hub.title).slice(0, maxDivisions);
        if (!divisions.length) {
          report.skipped.push({ title: hub.title, why: "no division sub-articles" });
          say(`  –  ${hub.title} — no division sub-articles`);
          continue;
        }
        say(`  ✓  ${hub.title} — ${divisions.length} division(s)`);

        for (const div of divisions) {
          let page: { title: string; html: string } | null = null;
          try {
            page = await wikiPage(div.title);
            report.divisionsFetched += 1;
          } catch (e) {
            report.warnings.push(`${div.title}: ${err(e)}`);
            say(`     !  ${div.division} — ${err(e)}`);
            continue;
          }
          if (!page) {
            report.skipped.push({ title: div.title, why: "no such page" });
            continue;
          }

          const bouts = parseBrackets(page.html);
          if (!bouts.length) {
            report.skipped.push({ title: div.title, why: "no bracket bouts parsed" });
            say(`     –  ${div.division} — no bracket found`);
            continue;
          }

          const meta = pageMeta(page.html);
          const card: TournamentCard = {
            sourceTitle: page.title,
            // sourceTitle stays verbatim (it is the provenance ref); the NAME is
            // slug-disambiguated so "+80 kg" cannot land on "80 kg"'s row.
            name: disambiguateName(page.title),
            division: div.division,
            date: meta.date ?? hubMeta.date,
            venue: meta.venue ?? hubMeta.venue,
            city: meta.city ?? hubMeta.city,
            country: meta.country ?? hubMeta.country,
            bouts,
          };

          const ev = toNormalizedEvent(card, source.sport, source.promotion, source.scheduledRounds);
          if (!ev) {
            // toNormalizedEvent refuses a card with no date rather than inventing
            // one — an event on the wrong day is worse than an event we skipped.
            report.skipped.push({ title: div.title, why: card.date ? "no bouts" : "no date on the page" });
            say(`     –  ${div.division} — ${card.date ? "no bouts" : "no date"}`);
            continue;
          }

          report.bracketBouts += bouts.length;
          const decided = bouts.filter((b) => b.winner !== null).length;
          say(`     ✓  ${div.division} — ${bouts.length} bouts (${decided} decided)`);
          events.push(ev);
        }
      }
    }
  }

  log.info(
    { events: events.length, bracketBouts: report.bracketBouts, medalBouts: report.medalBouts },
    "tournament:harvest:done",
  );
  return { events, report };
}

/**
 * Medal-table sports. Sambo and combat sambo share one championship page and are
 * two different sports to us, so the finals are split into one event each.
 */
function fromMedals(
  source: TournamentSource,
  hub: { title: string; html: string },
  hubMeta: ReturnType<typeof pageMeta>,
  report: TournamentReport,
): NormalizedEvent[] {
  const finals = parseMedalFinals(hub.html);
  if (!finals.length) {
    report.skipped.push({ title: hub.title, why: "no medal table" });
    return [];
  }

  const groups: { sport: typeof source.sport; name: string; bouts: TournamentBout[] }[] = [];
  const plain = finals.filter((f) => !f.combat);
  const combat = finals.filter((f) => f.combat);

  if (plain.length) groups.push({ sport: source.sport, name: hub.title, bouts: plain });
  if (combat.length && source.combatSport) {
    groups.push({ sport: source.combatSport, name: `${hub.title} — Combat Sambo`, bouts: combat });
  } else if (combat.length) {
    // No separate sport configured: keep the bouts rather than drop them.
    groups.push({ sport: source.sport, name: hub.title, bouts: combat });
  }

  const out: NormalizedEvent[] = [];
  for (const g of groups) {
    const card: TournamentCard = {
      sourceTitle: g.name === hub.title ? hub.title : `${hub.title}#combat`,
      name: g.name,
      division: null,
      date: hubMeta.date,
      venue: hubMeta.venue,
      city: hubMeta.city,
      country: hubMeta.country,
      bouts: g.bouts,
    };
    const ev = toNormalizedEvent(card, g.sport, source.promotion, source.scheduledRounds);
    if (!ev) {
      report.skipped.push({ title: hub.title, why: card.date ? "no bouts" : "no date on the page" });
      continue;
    }
    report.medalBouts += g.bouts.length;
    out.push(ev);
  }
  return out;
}
