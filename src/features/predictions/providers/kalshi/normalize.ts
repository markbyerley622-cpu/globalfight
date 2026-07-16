// ════════════════════════════════════════════════════════════════════════
//  Kalshi → Combat Register normalization (pure, unit-tested).
//
//  Kalshi models each fighter's win as its OWN binary market under a shared
//  `event_ticker`. We group by event_ticker to reconstruct the head-to-head:
//  two fighter-markets ⇒ one two-way PredictionMarket. A lone market falls back
//  to Yes/No. Prices are already dollars in [0,1] (implied probability).
// ════════════════════════════════════════════════════════════════════════

import type { PredictionMarket, PredictionOutcome } from "@/features/predictions/types";
import type { CombatSport } from "@/features/predictions/types";

export type KalshiMarket = {
  ticker: string;
  event_ticker: string;
  title?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  yes_bid_dollars?: number | string;
  yes_ask_dollars?: number | string;
  last_price_dollars?: number | string;
  volume_fp?: number | string;
  volume_24h_fp?: number | string;
  liquidity_dollars?: number | string;
  open_interest_fp?: number | string;
  open_time?: string;
  close_time?: string;
  status?: string;
};

/** Series → (sport, league). The two combat series Kalshi runs today. */
export const KALSHI_SERIES: Record<string, { sport: CombatSport; league: string | null }> = {
  KXUFCFIGHT: { sport: "MMA", league: "UFC" },
  KXBOXING: { sport: "Boxing", league: null },
};

const num = (v: number | string | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
};

/** Implied probability for a fighter market: last trade, else bid/ask mid. */
function marketProb(m: KalshiMarket): number {
  const last = num(m.last_price_dollars);
  if (last > 0) return Math.min(1, Math.max(0, last));
  const bid = num(m.yes_bid_dollars);
  const ask = num(m.yes_ask_dollars);
  if (bid > 0 || ask > 0) return Math.min(1, Math.max(0, (bid + ask) / 2));
  return 0;
}

const seriesOf = (eventTicker: string): string => eventTicker.split("-")[0];

/** Clean "A vs B" title from two fighter sub-titles. */
function fightTitle(a?: string, b?: string): string {
  const an = (a ?? "").trim();
  const bn = (b ?? "").trim();
  if (an && bn) return `${an} vs ${bn}`;
  return an || bn || "Fight";
}

function toOutcomes(group: KalshiMarket[]): {
  outcomes: PredictionOutcome[];
  tickerByOutcome: Record<string, string>;
} {
  const tickerByOutcome: Record<string, string> = {};
  let raw: { label: string; prob: number; ticker: string }[];

  if (group.length >= 2) {
    // Head-to-head: each market's Yes side is one fighter.
    raw = group.map((m) => ({
      label: (m.yes_sub_title ?? "").trim() || "Fighter",
      prob: marketProb(m),
      ticker: m.ticker,
    }));
  } else {
    // Single binary market → Yes / No.
    const m = group[0];
    const p = marketProb(m);
    raw = [
      { label: m.yes_sub_title?.trim() || "Yes", prob: p, ticker: m.ticker },
      { label: m.no_sub_title?.trim() || "No", prob: 1 - p, ticker: m.ticker },
    ];
  }

  const total = raw.reduce((a, r) => a + r.prob, 0) || 1;
  const outcomes = raw.map((r, i) => {
    const probability = r.prob / total;
    tickerByOutcome[`${i}`] = r.ticker;
    return {
      id: `${i}`,
      label: r.label,
      probability,
      oddsDecimal: probability > 0 ? +(1 / probability).toFixed(2) : 0,
    };
  });
  return { outcomes, tickerByOutcome };
}

/** Normalize one event-group of Kalshi markets, or null if not classifiable. */
export function normalizeGroup(eventTicker: string, group: KalshiMarket[]): PredictionMarket | null {
  const series = seriesOf(eventTicker);
  const meta = KALSHI_SERIES[series];
  if (!meta || group.length === 0) return null;

  const { outcomes, tickerByOutcome } = toOutcomes(group);
  if (outcomes.length < 2 || outcomes.every((o) => o.probability === 0)) return null;

  const a = group[0];
  const title =
    group.length >= 2
      ? fightTitle(group[0].yes_sub_title, group[1].yes_sub_title)
      : a.yes_sub_title?.trim() || a.title || "Fight";

  const opens = group.map((m) => m.open_time).filter(Boolean).sort()[0] ?? null;
  const closes = group.map((m) => m.close_time).filter(Boolean).sort().at(-1) ?? null;
  const open = group.some((m) => m.status === "active" || m.status === "open");

  // The favourite's market ticker drives the history line graph.
  const favIdx = outcomes.reduce((best, o, i) => (o.probability > outcomes[best].probability ? i : best), 0);

  return {
    id: `kalshi:${eventTicker}`,
    provider: "kalshi",
    title,
    description: a.title ?? null,
    sport: meta.sport,
    league: meta.league,
    category: series,
    status: open ? "open" : "closed",
    opensAt: opens,
    closesAt: closes,
    volume: group.reduce((s, m) => s + num(m.volume_fp), 0),
    liquidity: group.reduce((s, m) => s + num(m.liquidity_dollars), 0),
    outcomes,
    image: null,
    featured: false,
    hot: false,
    // No outbound trading link. Emitting a deep link into a prediction-market
    // venue is a referral to a trading platform — see TRADING_LINKS_ENABLED.
    sourceUrl: null,
    providerMetadata: {
      eventTicker,
      series,
      tickerByOutcome,
      favouriteOutcomeId: `${favIdx}`,
      favouriteTicker: tickerByOutcome[`${favIdx}`],
      volume24hr: group.reduce((s, m) => s + num(m.volume_24h_fp), 0),
    },
  };
}

/** Group a flat Kalshi market list by event_ticker and normalize each fight. */
export function normalizeMarkets(markets: KalshiMarket[]): PredictionMarket[] {
  const groups = new Map<string, KalshiMarket[]>();
  for (const m of markets) {
    if (!m.event_ticker) continue;
    const g = groups.get(m.event_ticker) ?? [];
    g.push(m);
    groups.set(m.event_ticker, g);
  }
  const out: PredictionMarket[] = [];
  for (const [ticker, group] of groups) {
    const n = normalizeGroup(ticker, group);
    if (n) out.push(n);
  }
  return out;
}
