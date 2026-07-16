// ════════════════════════════════════════════════════════════════════════
//  Derived engagement flags + sorting.
//
//  Providers don't tell us what's "hot" or "featured" — we derive it from
//  volume, 24h volume, liquidity, price movement and time-to-close, so the same
//  rules apply uniformly across every provider. Pure functions, unit-tested.
// ════════════════════════════════════════════════════════════════════════

import type { MarketSort, PredictionMarket } from "@/features/predictions/types";

const vol24 = (m: PredictionMarket): number =>
  Number(m.providerMetadata.volume24hr ?? 0) || 0;
const priceMove = (m: PredictionMarket): number =>
  Math.abs(Number(m.providerMetadata.oneDayPriceChange ?? 0)) || 0;

const closeMs = (m: PredictionMarket): number =>
  m.closesAt ? new Date(m.closesAt).getTime() : Infinity;

/** How "close to competitive" a market is — a 50/50 fight is more engaging. */
function competitiveness(m: PredictionMarket): number {
  if (m.outcomes.length < 2) return 0;
  const top = [...m.outcomes].sort((a, b) => b.probability - a.probability);
  return 1 - (top[0].probability - top[1].probability); // 1 = coin flip, 0 = lock
}

/**
 * Return a new array with `featured`/`hot` derived. `now` is injectable for
 * tests. Featured = the few biggest open markets; Hot = high recent activity.
 */
export function deriveFlags(
  markets: PredictionMarket[],
  now: number = Date.now(),
): PredictionMarket[] {
  const open = markets.filter((m) => m.status === "open");

  // Hot threshold: top quartile of 24h volume among open markets (min floor so
  // a quiet board doesn't flag everything).
  const v24 = open.map(vol24).sort((a, b) => a - b);
  const q75 = v24.length ? v24[Math.floor(v24.length * 0.75)] : 0;
  const hotFloor = Math.max(q75, 1000);

  // Featured: the three highest-volume open markets closing within 90 days.
  const soonWindow = now + 90 * 24 * 3600 * 1000;
  const featuredIds = new Set(
    [...open]
      .filter((m) => closeMs(m) <= soonWindow)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 3)
      .map((m) => m.id),
  );

  return markets.map((m) => ({
    ...m,
    featured: featuredIds.has(m.id),
    hot:
      m.status === "open" &&
      (vol24(m) >= hotFloor || priceMove(m) >= 0.1) &&
      m.volume > 0,
  }));
}

/** Sort a (already flag-derived) list for a UI tab. Does not mutate input. */
export function sortMarkets(
  markets: PredictionMarket[],
  sort: MarketSort = "popular",
): PredictionMarket[] {
  const list = [...markets];
  switch (sort) {
    case "closing":
      // Soonest-closing open markets first; closed/resolved sink to the bottom.
      return list.sort((a, b) => {
        const ao = a.status === "open" ? 0 : 1;
        const bo = b.status === "open" ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return closeMs(a) - closeMs(b);
      });
    case "trending":
      return list.sort(
        (a, b) => vol24(b) + competitiveness(b) * 1000 - (vol24(a) + competitiveness(a) * 1000),
      );
    case "new":
      return list.sort((a, b) => {
        const at = a.opensAt ? new Date(a.opensAt).getTime() : 0;
        const bt = b.opensAt ? new Date(b.opensAt).getTime() : 0;
        return bt - at;
      });
    case "popular":
    default:
      return list.sort((a, b) => b.volume - a.volume);
  }
}
