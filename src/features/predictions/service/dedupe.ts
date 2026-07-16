// Cross-provider de-duplication. The same fight can list on both Polymarket and
// Kalshi; showing it twice looks broken. We key by sport + the set of outcome
// surnames, and when two markets collide we keep the one with more volume (the
// more liquid, more trustworthy quote). Pure + unit-tested.

import type { PredictionMarket } from "@/features/predictions/types";

const surname = (label: string): string => {
  const cleaned = label.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  const parts = cleaned.split(/\s+/);
  return parts.at(-1) ?? cleaned;
};

/** Stable key for "the same real-world question". */
export function dedupeKey(m: PredictionMarket): string {
  const labels = m.outcomes.map((o) => o.label.toLowerCase());
  // Yes/No props key on the title (surnames would collapse unrelated props).
  const isYesNo = labels.length === 2 && labels.every((l) => l === "yes" || l === "no");
  if (isYesNo) {
    const t = m.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return `${m.sport}|prop|${t}`;
  }
  const key = m.outcomes.map((o) => surname(o.label)).sort().join("+");
  return `${m.sport}|${key}`;
}

/** Keep one market per real-world question, preferring higher volume. */
export function dedupeMarkets(markets: PredictionMarket[]): PredictionMarket[] {
  const best = new Map<string, PredictionMarket>();
  for (const m of markets) {
    const k = dedupeKey(m);
    const cur = best.get(k);
    if (!cur || m.volume > cur.volume) best.set(k, m);
  }
  return [...best.values()];
}
