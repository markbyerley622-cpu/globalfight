/**
 * Prediction service — INTERFACE + PLACEHOLDER implementation.
 *
 * This deliberately does NOT implement a production voting/betting system.
 * It defines the contract the UI codes against and derives display data from
 * fixtures, so a real persistence layer (DB, auth, rate-limiting, lock
 * enforcement) can be dropped in later without UI changes.
 *
 * No money, odds, or wagering — a prediction is a single free pick per bout.
 */
import type { Corner, PredictionMarket } from "@/lib/domain/types";
import { getMarketForFight, getResult } from "@/lib/data/store";

export interface PredictionSplit {
  redPct: number;
  bluePct: number;
  totalVotes: number;
  /** The authenticated user's current pick, if any. */
  userPick: Corner | null;
  locked: boolean;
  /** Set once the bout is settled. */
  correct: boolean | null;
  winnerCorner: Corner | null;
}

export interface PredictionService {
  getSplit(fightId: string, userId?: string): Promise<PredictionSplit>;
  castVote(fightId: string, corner: Corner, userId: string): Promise<PredictionSplit>;
  changeVote(fightId: string, corner: Corner, userId: string): Promise<PredictionSplit>;
}

/** Compute a percentage split from raw market option votes. */
export function splitFromMarket(market: PredictionMarket): { redPct: number; bluePct: number } {
  const red = market.options.find((o) => o.corner === "red")?.votes ?? 0;
  const blue = market.options.find((o) => o.corner === "blue")?.votes ?? 0;
  const total = red + blue;
  if (total === 0) return { redPct: 0, bluePct: 0 };
  const redPct = Math.round((red / total) * 100);
  return { redPct, bluePct: 100 - redPct };
}

/**
 * Placeholder implementation. In-memory only; votes are not persisted across
 * requests. Reads live percentages from the fixture market.
 */
export const predictionService: PredictionService = {
  async getSplit(fightId, _userId) {
    return buildSplit(fightId, null);
  },
  async castVote(fightId, corner, _userId) {
    // TODO: persist vote, enforce one-per-user, reject if market locked.
    return buildSplit(fightId, corner);
  },
  async changeVote(fightId, corner, _userId) {
    // TODO: update existing vote if market still open.
    return buildSplit(fightId, corner);
  },
};

function buildSplit(fightId: string, userPick: Corner | null): PredictionSplit {
  const market = getMarketForFight(fightId);
  if (!market) {
    return { redPct: 0, bluePct: 0, totalVotes: 0, userPick, locked: true, correct: null, winnerCorner: null };
  }
  const { redPct, bluePct } = splitFromMarket(market);
  const result = getResult(fightId);
  const winnerCorner = result?.winnerCorner ?? null;
  const correct = userPick && winnerCorner ? userPick === winnerCorner : null;
  return {
    redPct,
    bluePct,
    totalVotes: market.totalVotes,
    userPick,
    locked: market.status !== "open",
    correct,
    winnerCorner,
  };
}
