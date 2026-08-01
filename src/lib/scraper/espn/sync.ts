// ════════════════════════════════════════════════════════════════════════
//  ESPN MMA scoreboard provider.
//
//  A PURE DATA PROVIDER: acquires and transforms, never persists. The caller
//  hands the harvest to persistAggregated.
//
//  Why this source. ESPN publishes a public JSON scoreboard per promotion that
//  carries the WHOLE card — every bout, both corners with stable athlete ids, the
//  weight class, scheduled rounds, and the winner — and it accepts an arbitrary
//  date range, so a promotion's back catalogue is one request per year. For UFC
//  2024 that is 52 events, 52 of them with at least one marked winner, in a
//  single call. Nothing else we have comes close: bkfc.com and onefc.com render
//  results client-side, and Wikipedia needs a search-and-verify ladder per card.
//
//  One request per league-year. `dates=YYYYMMDD-YYYYMMDD` is the whole trick.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent } from "@/services/providers/types";
import { fetchPage } from "../http";
import { log } from "../logger";
import type { EspnLeague } from "./leagues";
import { toNormalizedEvent } from "./map";
import type { EspnReport, EspnScoreboard } from "./types";

const API = process.env.ESPN_API_URL ?? "https://site.api.espn.com/apis/site/v2/sports/mma";
/** ESPN caps a scoreboard response; a promotion never runs this many cards a year. */
const PAGE_LIMIT = 300;

export interface EspnSyncOpts {
  leagues: EspnLeague[];
  /** Calendar years to fetch, newest first. */
  years: number[];
  onProgress?: (line: string) => void;
}

export interface EspnHarvest {
  events: NormalizedEvent[];
  report: EspnReport;
}

const err = (e: unknown): string => (e as Error)?.message ?? String(e);

/** One league-year of cards. */
async function fetchYear(league: EspnLeague, year: number): Promise<EspnScoreboard> {
  const url = `${API}/${league.slug}/scoreboard?dates=${year}0101-${year}1231&limit=${PAGE_LIMIT}`;
  const { html } = await fetchPage(url);
  return JSON.parse(html) as EspnScoreboard;
}

export async function syncEspn(opts: EspnSyncOpts): Promise<EspnHarvest> {
  const say = opts.onProgress ?? (() => {});
  const events: NormalizedEvent[] = [];
  const report: EspnReport = {
    requests: 0,
    eventsSeen: 0,
    boutsSeen: 0,
    boutsDecided: 0,
    emptyCards: [],
    warnings: [],
  };

  for (const league of opts.leagues) {
    let leagueEvents = 0;
    let leagueBouts = 0;

    for (const year of opts.years) {
      let board: EspnScoreboard;
      try {
        board = await fetchYear(league, year);
        report.requests += 1;
      } catch (e) {
        report.warnings.push(`${league.key} ${year}: ${err(e)}`);
        say(`  !  ${league.promotion} ${year} — ${err(e)}`);
        continue;
      }

      for (const raw of board.events ?? []) {
        report.eventsSeen += 1;
        const bouts = raw.competitions ?? [];
        report.boutsSeen += bouts.length;
        report.boutsDecided += bouts.filter((c) =>
          (c.competitors ?? []).some((x) => x.winner),
        ).length;

        const ev = toNormalizedEvent(raw, league);
        // A card ESPN lists with no usable bout. Recorded rather than dropped:
        // "the source has this event but published no card for it" is the
        // documented reason an empty card stays empty, and it is the difference
        // between a source gap and a parser bug.
        if (!ev || !ev.fights?.length) {
          report.emptyCards.push({
            league: league.key,
            name: raw.name ?? raw.shortName ?? `id ${raw.id}`,
            date: (raw.date ?? "").slice(0, 10),
          });
          continue;
        }
        events.push(ev);
        leagueEvents += 1;
        leagueBouts += ev.fights.length;
      }
    }
    say(`  ✓  ${league.promotion.padEnd(18)} ${String(leagueEvents).padStart(4)} cards, ${String(leagueBouts).padStart(5)} bouts`);
  }

  log.info(
    { events: events.length, bouts: report.boutsSeen, decided: report.boutsDecided },
    "espn:harvest:done",
  );
  return { events, report };
}
