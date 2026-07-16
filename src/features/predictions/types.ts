// ════════════════════════════════════════════════════════════════════════
//  Combat Register — normalized prediction model.
//
//  The UI consumes ONLY these types. Nothing downstream of a provider should
//  ever see Polymarket's or Kalshi's raw schema — that coupling stops at the
//  provider's `normalizeMarket()`. Add a new provider (Manifold, Kalshi, our
//  own markets) by implementing `PredictionProvider`; the UI never changes.
// ════════════════════════════════════════════════════════════════════════

/** Canonical combat sports. Values match the Predictions UI sport filter. */
export const COMBAT_SPORTS = [
  "Boxing",
  "MMA",
  "Kickboxing",
  "Muay Thai",
  "BJJ",
  "Bare Knuckle",
  "Wrestling",
  "Misfits",
] as const;
export type CombatSport = (typeof COMBAT_SPORTS)[number];

export type ProviderId = "polymarket" | "kalshi" | "fixtures";

export type MarketStatus = "open" | "closed" | "resolved";

/** One side of a market. `probability` is the de-vigged implied chance 0..1. */
export type PredictionOutcome = {
  id: string;
  label: string;
  /** Short subtitle, e.g. a record or "Yes"/"No" qualifier. */
  sub?: string;
  /** Implied probability 0..1 (already normalized across the market's outcomes). */
  probability: number;
  /** Decimal odds derived from probability (1/p), for display. */
  oddsDecimal: number;
  /** Winner once resolved. */
  winner?: boolean;
};

/** A single time-series point for the probability line graph. */
export type HistoryPoint = { t: number; p: number }; // t = unix seconds, p = 0..1

/** Price history for a market's primary ("Yes"/favourite) outcome. */
export type MarketHistory = {
  marketId: string;
  provider: ProviderId;
  /** The outcome the series tracks (label), e.g. "Yes" or the favourite. */
  outcomeLabel: string;
  points: HistoryPoint[];
};

/**
 * The one model the whole app speaks. Every provider maps into this; the UI,
 * hooks and API responses only ever carry this shape.
 */
export type PredictionMarket = {
  /** Stable, provider-namespaced id, e.g. "polymarket:0xabc" or "kalshi:KX…". */
  id: string;
  provider: ProviderId;
  title: string;
  description: string | null;
  sport: CombatSport;
  /** Promotion/organiser when known, e.g. "UFC", "Misfits", "BKFC". */
  league: string | null;
  /** Provider's own category label (for debugging/telemetry), e.g. "mma". */
  category: string | null;
  status: MarketStatus;
  opensAt: string | null; // ISO
  closesAt: string | null; // ISO
  volume: number; // USD, best-effort
  liquidity: number; // USD, best-effort
  outcomes: PredictionOutcome[];
  image: string | null;
  /** Derived engagement flags (see service/featured.ts). */
  featured: boolean;
  hot: boolean;
  /** Deep link to the source market page. */
  sourceUrl: string | null;
  /** Opaque per-provider extras (token ids, tickers…) — never rendered blind. */
  providerMetadata: Record<string, unknown>;
};

export type MarketSort = "popular" | "closing" | "trending" | "new";

export type MarketQuery = {
  sport?: CombatSport | "all";
  sort?: MarketSort;
  /** Free-text search across title/description/outcomes. */
  q?: string;
  limit?: number;
};

/**
 * A prediction data source. `normalizeMarket` is intentionally part of the
 * contract even though it's called internally — it documents that the mapping
 * from raw → normalized is the provider's responsibility and nowhere else's.
 */
export interface PredictionProvider {
  readonly id: ProviderId;
  /** Whether this provider is configured/enabled in the current environment. */
  isEnabled(): boolean;
  /** All combat markets this provider can surface, already normalized. */
  listMarkets(): Promise<PredictionMarket[]>;
  /** A single normalized market by its bare (un-namespaced) id, or null. */
  getMarket(rawId: string): Promise<PredictionMarket | null>;
  /** Probability history for the market's primary outcome, or null. */
  getMarketHistory(rawId: string): Promise<MarketHistory | null>;
}

/** Strip the "provider:" prefix from a normalized market id. */
export function rawId(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(i + 1);
}

/** Which provider a normalized id belongs to. */
export function providerOf(id: string): ProviderId | null {
  const p = id.slice(0, id.indexOf(":"));
  return p === "polymarket" || p === "kalshi" || p === "fixtures" ? p : null;
}
