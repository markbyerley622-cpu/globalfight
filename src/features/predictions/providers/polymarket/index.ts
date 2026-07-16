// ════════════════════════════════════════════════════════════════════════
//  Polymarket provider — the first live source.
//
//  Reads the public Gamma API (events + nested markets) and the CLOB
//  price-history endpoint. No auth/keys required for reads; everything runs
//  server-side. Combat tags are queried directly to keep payloads small, then
//  the normalizer applies the strict combat gate.
// ════════════════════════════════════════════════════════════════════════

import type {
  MarketHistory,
  PredictionMarket,
  PredictionProvider,
} from "@/features/predictions/types";
import { fetchJson } from "@/features/predictions/providers/http";
import { plog } from "@/features/predictions/logger";
import {
  normalizeEvents,
  tokenIds,
  type GammaEvent,
  type GammaMarket,
} from "./normalize";
import { flags, marketDataAllowed } from "@/lib/feature-flags";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const log = plog.child({ provider: "polymarket" });

// Combat-sports tag slugs Polymarket organises markets under. Querying by tag
// keeps us off unrelated markets (politics/crypto) before we even normalize.
const COMBAT_TAGS = ["mma", "ufc", "boxing", "combat-sports", "kickboxing"];
const PAGE = 100;

type HistoryResponse = { history?: { t: number; p: number }[] };

async function fetchTagEvents(tag: string): Promise<GammaEvent[]> {
  const url =
    `${GAMMA}/events?limit=${PAGE}&closed=false&active=true` +
    `&order=volume24hr&ascending=false&tag_slug=${encodeURIComponent(tag)}`;
  return fetchJson<GammaEvent[]>(url, { timeoutMs: 8000, retries: 1 });
}

export class PolymarketProvider implements PredictionProvider {
  readonly id = "polymarket" as const;

  /**
   * FAIL CLOSED. Previously `!== "off"`, so an unset variable ENABLED it — and the
   * variable existed nowhere in the config. Polymarket's consumer ToS bars
   * commercial use, public display, and scraping.
   */
  isEnabled(): boolean {
    return marketDataAllowed() && flags().polymarketEnabled;
  }

  async listMarkets(): Promise<PredictionMarket[]> {
    const started = Date.now();
    // Fetch each combat tag; a failing tag doesn't sink the others.
    const settled = await Promise.allSettled(COMBAT_TAGS.map(fetchTagEvents));

    const events: GammaEvent[] = [];
    let failures = 0;
    for (const r of settled) {
      if (r.status === "fulfilled") events.push(...r.value);
      else failures++;
    }
    if (events.length === 0 && failures > 0) {
      throw new Error(`polymarket: all ${failures} tag fetches failed`);
    }

    // De-dupe events that carry multiple combat tags (e.g. mma + ufc).
    const seen = new Set<string>();
    const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));

    const markets = normalizeEvents(unique);
    log.info(
      { fetched: events.length, uniqueEvents: unique.length, markets: markets.length, failures, durationMs: Date.now() - started },
      "listMarkets",
    );
    return markets;
  }

  async getMarket(rawId: string): Promise<PredictionMarket | null> {
    // Cold-path fallback (service normally resolves from the cached list).
    const all = await this.listMarkets();
    return all.find((m) => m.providerMetadata.conditionId === rawId || m.id === `polymarket:${rawId}`) ?? null;
  }

  async getMarketHistory(rawId: string): Promise<MarketHistory | null> {
    const all = await this.listMarkets();
    const market = all.find(
      (m) => m.providerMetadata.conditionId === rawId || m.id === `polymarket:${rawId}`,
    );
    const ids = (market?.providerMetadata.clobTokenIds as string[] | undefined) ?? [];
    if (!market || ids.length === 0) return null;

    const url = `${CLOB}/prices-history?market=${ids[0]}&interval=1m&fidelity=180`;
    try {
      const res = await fetchJson<HistoryResponse>(url, { timeoutMs: 8000, retries: 1 });
      const points = (res.history ?? []).filter(
        (pt) => Number.isFinite(pt.t) && Number.isFinite(pt.p),
      );
      if (points.length === 0) return null;
      return {
        marketId: market.id,
        provider: "polymarket",
        outcomeLabel: market.outcomes[0]?.label ?? "Yes",
        points,
      };
    } catch (err) {
      log.warn({ rawId, err: String(err) }, "history fetch failed");
      return null;
    }
  }
}

// Re-export the raw types so tests can import from the provider entrypoint.
export type { GammaEvent, GammaMarket };
