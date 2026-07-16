// ════════════════════════════════════════════════════════════════════════
//  Live market view — read-only consensus from the licensed odds feed.
//
//  Unlike repo.getOddsForFight (which only returns lines for fights already in
//  our DB), this surfaces EVERY live boxing/MMA event the aggregator carries,
//  so the betting page reflects the real market even before a fight is seeded.
//  Analytical only — no wagering is processed.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { devig } from "@/lib/utils";
import { fetchMarketOdds, type SportLabel } from "./provider";

export interface LiveMarketRow {
  externalId: string;
  commenceTime: string;
  sport: SportLabel;
  red: string;
  blue: string;
  books: number;
  redOdds: number;   // consensus (average) decimal price
  blueOdds: number;
  bestRed: number;   // best available price for each side
  bestBlue: number;
  fairRed: number;   // de-vigged probability 0..1
  fairBlue: number;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Aggregated, de-vigged consensus for every live boxing/MMA event. */
export async function getLiveMarket(): Promise<LiveMarketRow[]> {
  const events = await fetchMarketOdds();

  const rows = events.map((e): LiveMarketRow => {
    const reds = e.books.map((b) => b.redOdds);
    const blues = e.books.map((b) => b.blueOdds);
    const redOdds = +avg(reds).toFixed(2);
    const blueOdds = +avg(blues).toFixed(2);
    const fair = devig(redOdds, blueOdds);
    return {
      externalId: e.externalId,
      commenceTime: e.commenceTime,
      sport: e.sport,
      red: e.red,
      blue: e.blue,
      books: e.books.length,
      redOdds,
      blueOdds,
      bestRed: +Math.max(...reds).toFixed(2),
      bestBlue: +Math.max(...blues).toFixed(2),
      fairRed: fair.red,
      fairBlue: fair.blue,
    };
  });

  // Soonest fights first.
  return rows.sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
}
