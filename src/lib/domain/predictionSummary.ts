/**
 * Derives the event-level prediction summary from a set of bout markets.
 * Pure domain logic — no persistence, no React.
 */
import type { Fight, PredictionMarket } from "./types";
import { splitFromMarket } from "@/lib/services/predictions";

export interface MarketInsight {
  fightId: string;
  /** Winning-side percentage (the community favourite's share). */
  favouritePct: number;
  /** Margin between the two sides; small = close, large = lopsided. */
  margin: number;
  totalVotes: number;
}

export interface CommunityPredictionSummary {
  boutsWithMarkets: number;
  totalVotes: number;
  /** The most lopsided market (clearest community favourite). */
  strongestFavourite?: MarketInsight;
  /** The market split closest to 50/50. */
  closest?: MarketInsight;
  /** The market with the largest disagreement in raw vote volume. */
  biggestDisagreement?: MarketInsight;
}

export function buildPredictionSummary(
  markets: PredictionMarket[],
  _fights: Fight[],
): CommunityPredictionSummary {
  const insights: MarketInsight[] = markets.map((m) => {
    const { redPct, bluePct } = splitFromMarket(m);
    const favouritePct = Math.max(redPct, bluePct);
    return {
      fightId: m.fightId,
      favouritePct,
      margin: Math.abs(redPct - bluePct),
      totalVotes: m.totalVotes,
    };
  });

  const totalVotes = insights.reduce((sum, i) => sum + i.totalVotes, 0);
  if (insights.length === 0) {
    return { boutsWithMarkets: 0, totalVotes: 0 };
  }

  const sortedByMargin = [...insights].sort((a, b) => a.margin - b.margin);
  const strongestFavourite = sortedByMargin[sortedByMargin.length - 1];
  const closest = sortedByMargin[0];
  // "Biggest disagreement" = closest split carrying the most votes (most
  // people, most divided) — the most contested bout on the card.
  const biggestDisagreement = [...insights]
    .sort((a, b) => a.margin - b.margin || b.totalVotes - a.totalVotes)[0];

  return {
    boutsWithMarkets: insights.length,
    totalVotes,
    strongestFavourite,
    closest,
    biggestDisagreement,
  };
}
