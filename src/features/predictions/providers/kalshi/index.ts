// ════════════════════════════════════════════════════════════════════════
//  Kalshi provider — second live source.
//
//  Public read API (no key needed for market data). We pull the two combat
//  series (UFC + boxing), group per fight in the normalizer, and read the
//  candlesticks endpoint for the probability history line.
// ════════════════════════════════════════════════════════════════════════

import type {
  MarketHistory,
  PredictionMarket,
  PredictionProvider,
} from "@/features/predictions/types";
import { fetchJson } from "@/features/predictions/providers/http";
import { plog } from "@/features/predictions/logger";
import { normalizeMarkets, KALSHI_SERIES, type KalshiMarket } from "./normalize";
import { flags, marketDataAllowed } from "@/lib/feature-flags";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const log = plog.child({ provider: "kalshi" });
const PAGE = 200;

type MarketsResponse = { markets?: KalshiMarket[] };
type Candle = {
  end_period_ts: number;
  price?: { close_dollars?: string | number };
  yes_bid?: { close_dollars?: string | number };
  yes_ask?: { close_dollars?: string | number };
};
type CandlesResponse = { candlesticks?: Candle[] };

const numOf = (v: string | number | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? (n as number) : NaN;
};

async function fetchSeries(series: string): Promise<KalshiMarket[]> {
  const url = `${BASE}/markets?limit=${PAGE}&series_ticker=${series}&status=open`;
  const res = await fetchJson<MarketsResponse>(url, { timeoutMs: 8000, retries: 1 });
  return res.markets ?? [];
}

export class KalshiProvider implements PredictionProvider {
  readonly id = "kalshi" as const;

  /**
   * FAIL CLOSED. Previously `process.env.PREDICTIONS_KALSHI !== "off"` — an unset
   * variable ENABLED the provider, and the variable was defined nowhere, so Kalshi
   * was live in production and its data was being CDN-cached and publicly
   * redistributed. Kalshi's data terms forbid caching, third-party display, and
   * commercial/non-member use.
   *
   * Two locks: the provider flag AND the umbrella market-prices flag. Turning a
   * provider on for a back-office task must not silently publish prices.
   */
  isEnabled(): boolean {
    return marketDataAllowed() && flags().kalshiEnabled;
  }

  async listMarkets(): Promise<PredictionMarket[]> {
    const started = Date.now();
    const series = Object.keys(KALSHI_SERIES);
    const settled = await Promise.allSettled(series.map(fetchSeries));

    const markets: KalshiMarket[] = [];
    let failures = 0;
    for (const r of settled) {
      if (r.status === "fulfilled") markets.push(...r.value);
      else failures++;
    }
    if (markets.length === 0 && failures > 0) {
      throw new Error(`kalshi: all ${failures} series fetches failed`);
    }

    const normalized = normalizeMarkets(markets);
    log.info(
      { rawMarkets: markets.length, markets: normalized.length, failures, durationMs: Date.now() - started },
      "listMarkets",
    );
    return normalized;
  }

  async getMarket(rawId: string): Promise<PredictionMarket | null> {
    const all = await this.listMarkets();
    return all.find((m) => m.id === `kalshi:${rawId}` || m.providerMetadata.eventTicker === rawId) ?? null;
  }

  async getMarketHistory(rawId: string): Promise<MarketHistory | null> {
    const all = await this.listMarkets();
    const market = all.find(
      (m) => m.id === `kalshi:${rawId}` || m.providerMetadata.eventTicker === rawId,
    );
    if (!market) return null;

    const series = market.providerMetadata.series as string | undefined;
    const ticker = market.providerMetadata.favouriteTicker as string | undefined;
    const favId = market.providerMetadata.favouriteOutcomeId as string | undefined;
    if (!series || !ticker) return null;

    const end = Math.floor(Date.now() / 1000);
    const start = end - 21 * 24 * 3600; // ~3 weeks
    const url =
      `${BASE}/series/${series}/markets/${ticker}/candlesticks` +
      `?start_ts=${start}&end_ts=${end}&period_interval=60`;

    try {
      const res = await fetchJson<CandlesResponse>(url, { timeoutMs: 8000, retries: 1 });
      const points = (res.candlesticks ?? [])
        .map((c) => {
          const close = numOf(c.price?.close_dollars);
          const mid =
            (numOf(c.yes_bid?.close_dollars) + numOf(c.yes_ask?.close_dollars)) / 2;
          const p = Number.isFinite(close) ? close : mid;
          return { t: c.end_period_ts, p };
        })
        .filter((pt) => Number.isFinite(pt.t) && Number.isFinite(pt.p));
      if (points.length === 0) return null;

      const favLabel =
        market.outcomes.find((o) => o.id === favId)?.label ?? market.outcomes[0]?.label ?? "";
      return { marketId: market.id, provider: "kalshi", outcomeLabel: favLabel, points };
    } catch (err) {
      log.warn({ rawId, err: String(err) }, "history fetch failed");
      return null;
    }
  }
}

export type { KalshiMarket };
