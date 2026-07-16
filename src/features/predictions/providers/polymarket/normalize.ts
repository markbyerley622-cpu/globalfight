// ════════════════════════════════════════════════════════════════════════
//  Polymarket → Combat Register normalization (pure, unit-tested).
//  Raw schema stops here: nothing outside this file may read a `gamma*` field.
// ════════════════════════════════════════════════════════════════════════

import type { PredictionMarket, PredictionOutcome } from "@/features/predictions/types";
import { classifySport, leagueFrom } from "@/features/predictions/service/combat-filter";

// Only the fields we consume (Gamma returns ~80 per market).
export type GammaTag = { slug?: string; label?: string };
export type GammaMarket = {
  id: string;
  conditionId?: string;
  question?: string;
  slug?: string;
  description?: string | null;
  outcomes?: string; // JSON-encoded string[] e.g. '["Yes","No"]'
  outcomePrices?: string; // JSON-encoded string[] e.g. '["0.95","0.05"]'
  volumeNum?: number;
  liquidityNum?: number;
  volume24hr?: number;
  oneDayPriceChange?: number;
  startDate?: string;
  endDate?: string;
  image?: string | null;
  icon?: string | null;
  active?: boolean;
  closed?: boolean;
  clobTokenIds?: string; // JSON-encoded string[]
  groupItemTitle?: string;
};
export type GammaEvent = {
  id: string;
  title?: string;
  slug?: string;
  description?: string | null;
  image?: string | null;
  icon?: string | null;
  volume?: number;
  liquidity?: number;
  featured?: boolean;
  tags?: GammaTag[];
  markets?: GammaMarket[];
};

/** Parse a Gamma JSON-encoded string array, tolerating malformed input. */
export function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** clobTokenIds parsed to a real array (used for history lookups). */
export function tokenIds(m: GammaMarket): string[] {
  return parseJsonArray(m.clobTokenIds);
}

function buildOutcomes(m: GammaMarket): PredictionOutcome[] {
  const labels = parseJsonArray(m.outcomes);
  const prices = parseJsonArray(m.outcomePrices).map((p) => Number(p));
  if (labels.length === 0) return [];

  // Prices are provider-quoted implied probabilities; normalize to sum 1 so the
  // headline percentages the UI shows always add up.
  const nums = labels.map((_, i) => (Number.isFinite(prices[i]) ? Math.max(0, prices[i]) : 0));
  const total = nums.reduce((a, b) => a + b, 0) || 1;

  return labels.map((label, i) => {
    const probability = nums[i] / total;
    return {
      id: `${i}`,
      label,
      probability,
      oddsDecimal: probability > 0 ? +(1 / probability).toFixed(2) : 0,
    };
  });
}

const tagStrings = (e: GammaEvent): string[] =>
  (e.tags ?? []).flatMap((t) => [t.slug, t.label].filter(Boolean) as string[]);

/**
 * Map one Gamma event+market into a normalized market, or null if it isn't a
 * confidently-combat market. One Gamma market ⇒ one PredictionMarket.
 */
export function normalizeMarket(event: GammaEvent, market: GammaMarket): PredictionMarket | null {
  const title = market.question?.trim() || event.title?.trim() || "";
  if (!title) return null;

  const classifyInput = {
    title,
    description: market.description ?? event.description ?? null,
    tags: tagStrings(event),
  };
  const sport = classifySport(classifyInput);
  if (!sport) return null;

  const outcomes = buildOutcomes(market);
  if (outcomes.length < 2) return null; // need at least a two-way market

  const closed = Boolean(market.closed) || market.active === false;
  const id = market.conditionId || market.id;

  return {
    id: `polymarket:${id}`,
    provider: "polymarket",
    title,
    description: market.description ?? event.description ?? null,
    sport,
    league: leagueFrom(classifyInput),
    category: (event.tags ?? [])[0]?.slug ?? null,
    status: closed ? "closed" : "open",
    opensAt: market.startDate ?? null,
    closesAt: market.endDate ?? null,
    volume: Number(market.volumeNum ?? event.volume ?? 0) || 0,
    liquidity: Number(market.liquidityNum ?? event.liquidity ?? 0) || 0,
    outcomes,
    image: market.image || market.icon || event.image || event.icon || null,
    featured: false, // derived later by service/featured.ts
    hot: false,
    // No outbound trading link — see TRADING_LINKS_ENABLED.
    sourceUrl: null,
    providerMetadata: {
      conditionId: market.conditionId ?? null,
      gammaId: market.id,
      clobTokenIds: tokenIds(market),
      volume24hr: Number(market.volume24hr ?? 0) || 0,
      oneDayPriceChange: Number(market.oneDayPriceChange ?? 0) || 0,
    },
  };
}

/** Flatten an events response into normalized markets (combat only). */
export function normalizeEvents(events: GammaEvent[]): PredictionMarket[] {
  const out: PredictionMarket[] = [];
  for (const e of events) {
    for (const m of e.markets ?? []) {
      const n = normalizeMarket(e, m);
      if (n) out.push(n);
    }
  }
  return out;
}
