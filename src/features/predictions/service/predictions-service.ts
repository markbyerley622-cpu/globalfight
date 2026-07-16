// ════════════════════════════════════════════════════════════════════════
//  Predictions service — the ONE thing API routes call.
//
//  Orchestrates: fan-out to enabled providers → merge → dedupe → derive
//  featured/hot → cache (SWR) → filter/sort/search for the request. Every step
//  is fault-tolerant: a dead provider is skipped, a total live failure serves
//  cache, and a cold cache serves fixtures. The page can never break.
// ════════════════════════════════════════════════════════════════════════

import type {
  CombatSport,
  MarketHistory,
  MarketQuery,
  PredictionMarket,
} from "@/features/predictions/types";
import { COMBAT_SPORTS, providerOf, rawId } from "@/features/predictions/types";
import {
  predictionsCache,
  MARKETS_TTL_MS,
  MARKETS_STALE_MS,
  HISTORY_TTL_MS,
  HISTORY_STALE_MS,
} from "@/features/predictions/repository/cache";
import { deriveFlags, sortMarkets } from "./featured";
import { dedupeMarkets } from "./dedupe";
import {
  enabledProviders,
  providerById,
  FIXTURES_PROVIDER,
} from "@/features/predictions/providers";
import { plog } from "@/features/predictions/logger";

const log = plog.child({ mod: "service" });
const MARKETS_KEY = "predictions:markets";

/** Fan out to every enabled live provider; merge, dedupe, derive flags. */
async function loadLiveMarkets(): Promise<PredictionMarket[]> {
  const started = Date.now();
  const providers = enabledProviders();
  const settled = await Promise.allSettled(providers.map((p) => p.listMarkets()));

  const merged: PredictionMarket[] = [];
  let ok = 0;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ok++;
      merged.push(...r.value);
    } else {
      log.warn({ provider: providers[i].id, err: String(r.reason) }, "provider failed");
    }
  });

  if (merged.length === 0) {
    // Nothing live — throw so the SWR layer serves stale if it has any.
    throw new Error("no live markets from any provider");
  }

  const deduped = dedupeMarkets(merged);
  const flagged = deriveFlags(deduped);
  log.info(
    {
      providersOk: ok,
      providersTotal: providers.length,
      rawMarkets: merged.length,
      afterDedupe: deduped.length,
      featured: flagged.filter((m) => m.featured).length,
      hot: flagged.filter((m) => m.hot).length,
      durationMs: Date.now() - started,
    },
    "loadLiveMarkets",
  );
  return flagged;
}

/** Cached full market set, with fixtures as the ultimate fallback. */
async function getAllMarkets(): Promise<PredictionMarket[]> {
  try {
    return await predictionsCache.get(MARKETS_KEY, loadLiveMarkets, {
      ttlMs: MARKETS_TTL_MS,
      staleMs: MARKETS_STALE_MS,
    });
  } catch (err) {
    log.warn({ err: String(err), state: "fixtures-fallback" }, "serving fixtures");
    return deriveFlags(await FIXTURES_PROVIDER.listMarkets());
  }
}

function applyQuery(all: PredictionMarket[], query: MarketQuery): PredictionMarket[] {
  let list = all;

  if (query.sport && query.sport !== "all") {
    list = list.filter((m) => m.sport === query.sport);
  }

  if (query.q?.trim()) {
    const needle = query.q.trim().toLowerCase();
    list = list.filter(
      (m) =>
        m.title.toLowerCase().includes(needle) ||
        (m.description ?? "").toLowerCase().includes(needle) ||
        m.outcomes.some((o) => o.label.toLowerCase().includes(needle)) ||
        (m.league ?? "").toLowerCase().includes(needle),
    );
  }

  list = sortMarkets(list, query.sort ?? "popular");
  if (query.limit && query.limit > 0) list = list.slice(0, query.limit);
  return list;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function listMarkets(query: MarketQuery = {}): Promise<PredictionMarket[]> {
  const all = await getAllMarkets();
  return applyQuery(all, query);
}

export async function searchMarkets(q: string, query: MarketQuery = {}): Promise<PredictionMarket[]> {
  return listMarkets({ ...query, q });
}

export async function getMarket(id: string): Promise<PredictionMarket | null> {
  // Resolve from the cached set first (cheap, consistent with the list view).
  const all = await getAllMarkets();
  const hit = all.find((m) => m.id === id);
  if (hit) return hit;

  // Cold path: ask the owning provider directly.
  const pid = providerOf(id);
  if (!pid) return null;
  try {
    return await providerById(pid).getMarket(rawId(id));
  } catch (err) {
    log.warn({ id, err: String(err) }, "getMarket cold path failed");
    return null;
  }
}

export async function getMarketHistory(id: string): Promise<MarketHistory | null> {
  const pid = providerOf(id);
  if (!pid) return null;
  return predictionsCache.get(
    `predictions:history:${id}`,
    async () => {
      try {
        return await providerById(pid).getMarketHistory(rawId(id));
      } catch (err) {
        log.warn({ id, err: String(err) }, "history failed");
        return null;
      }
    },
    { ttlMs: HISTORY_TTL_MS, staleMs: HISTORY_STALE_MS },
  );
}

export type CategoryCount = { sport: CombatSport; count: number };

/** Combat sports present in the current market set, with counts. */
export async function getCategories(): Promise<CategoryCount[]> {
  const all = await getAllMarkets();
  const counts = new Map<CombatSport, number>();
  for (const m of all) counts.set(m.sport, (counts.get(m.sport) ?? 0) + 1);
  return COMBAT_SPORTS.map((sport) => ({ sport, count: counts.get(sport) ?? 0 })).filter(
    (c) => c.count > 0,
  );
}
