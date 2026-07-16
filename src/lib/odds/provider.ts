// ════════════════════════════════════════════════════════════════════════
//  Odds provider — REAL bookmaker lines (licensed aggregator).
//
//  A legal, licensed h2h odds feed across many sportsbooks, with boxing & MMA
//  coverage. This is the ONLY legitimate way to surface market odds; we never
//  scrape sportsbooks (against their ToS) and we never present model-derived
//  numbers as market data.
//
//  Configure the feed key in .env. Without it, the provider returns [] and the
//  UI shows an honest "no live market connected" state — it does NOT fabricate.
// ════════════════════════════════════════════════════════════════════════

import { log } from "@/lib/scraper/logger";

const BASE = process.env.ODDS_API_BASE ?? "https://api.the-odds-api.com/v4";
// Sport feed keys → human label shown in the UI.
const SPORTS = (process.env.ODDS_API_SPORTS ?? "boxing_boxing,mma_mixed_martial_arts").split(",");

export type SportLabel = "Boxing" | "MMA" | "Muay Thai" | "Kickboxing";

function sportLabel(key: string): SportLabel {
  if (key.startsWith("boxing")) return "Boxing";
  if (key.includes("muay")) return "Muay Thai";
  if (key.includes("kick")) return "Kickboxing";
  return "MMA";
}

export interface BookLine {
  bookmaker: string;
  redOdds: number;   // decimal odds for the first listed competitor
  blueOdds: number;
  drawOdds?: number;
}

export interface MarketEvent {
  externalId: string;
  commenceTime: string;
  sport: SportLabel;
  red: string;       // competitor names exactly as the book lists them
  blue: string;
  books: BookLine[];
}

interface OddsApiOutcome { name: string; price: number }
interface OddsApiMarket { key: string; outcomes: OddsApiOutcome[] }
interface OddsApiBook { title: string; markets: OddsApiMarket[] }
interface OddsApiEvent {
  id: string; commence_time: string; home_team: string; away_team: string; bookmakers: OddsApiBook[];
}

/**
 * Bookmakers list a bout before the opponent is announced, using a placeholder for
 * the empty side ("TBA", "Opponent TBA", "TBD"…). Those are not people.
 *
 * We take competitor names verbatim from the feed, so without this guard the
 * placeholder is upserted as a real Fighter, given a slug, and rendered on the
 * schedule as "Opponent TBA vs TBA" — and every future placeholder bout collapses
 * onto that same slug, because they all share the name.
 *
 * A bout is only real once BOTH sides are named. Until then we skip it; it will be
 * ingested normally on a later run once the opponent is announced.
 */
const PLACEHOLDER_COMPETITOR =
  /^(opponent\s+)?(tba|tbd|tbc|to\s+be\s+(announced|advised|confirmed|determined)|unknown|opponent)$/i;

function isPlaceholderCompetitor(name: string): boolean {
  return PLACEHOLDER_COMPETITOR.test(name.trim());
}

/** Pull live h2h odds for boxing + MMA from the licensed odds feed. */
export async function fetchMarketOdds(): Promise<MarketEvent[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    log.warn({}, "odds:no-api-key — skipping (no live market connected)");
    return [];
  }

  const out: MarketEvent[] = [];
  for (const sport of SPORTS) {
    const url = `${BASE}/sports/${sport}/odds?regions=us,uk,eu&markets=h2h&oddsFormat=decimal&apiKey=${key}`;
    try {
      const resp = await fetch(url, { headers: { accept: "application/json" } });
      if (!resp.ok) { log.warn({ sport, status: resp.status }, "odds:fetch-failed"); continue; }
      const events = (await resp.json()) as OddsApiEvent[];
      let skipped = 0;
      for (const e of events) {
        // Not a bout yet — the opponent has not been announced. See PLACEHOLDER_COMPETITOR.
        if (isPlaceholderCompetitor(e.home_team) || isPlaceholderCompetitor(e.away_team)) {
          skipped++;
          continue;
        }
        const books: BookLine[] = e.bookmakers
          .map((b): BookLine | null => {
            const h2h = b.markets.find((m) => m.key === "h2h");
            const red = h2h?.outcomes.find((o) => o.name === e.home_team)?.price;
            const blue = h2h?.outcomes.find((o) => o.name === e.away_team)?.price;
            const draw = h2h?.outcomes.find((o) => /draw/i.test(o.name))?.price;
            return red && blue ? { bookmaker: b.title, redOdds: red, blueOdds: blue, drawOdds: draw } : null;
          })
          .filter((x): x is BookLine => x !== null);
        if (books.length) {
          out.push({ externalId: e.id, commenceTime: e.commence_time, sport: sportLabel(sport), red: e.home_team, blue: e.away_team, books });
        }
      }
      log.info({ sport, events: events.length, skippedUnannounced: skipped }, "odds:fetched");
    } catch (err) {
      log.error({ sport, err: (err as Error).message }, "odds:error");
    }
  }
  return out;
}
