// Provider registry. Order = merge priority (first wins on cross-provider
// dedupe ties before volume is considered). Add a provider here — Manifold, or
// Combat Register's own markets — and the rest of the system picks it up with
// no other change.

import type { PredictionProvider, ProviderId } from "@/features/predictions/types";
import { PolymarketProvider } from "./polymarket";
import { KalshiProvider } from "./kalshi";
import { FixturesProvider } from "./fixtures";

export const LIVE_PROVIDERS: PredictionProvider[] = [
  new PolymarketProvider(),
  new KalshiProvider(),
];

export const FIXTURES_PROVIDER = new FixturesProvider();

/** Enabled live providers for the current environment. */
export function enabledProviders(): PredictionProvider[] {
  return LIVE_PROVIDERS.filter((p) => p.isEnabled());
}

const ALL: Record<ProviderId, PredictionProvider> = {
  polymarket: LIVE_PROVIDERS[0],
  kalshi: LIVE_PROVIDERS[1],
  fixtures: FIXTURES_PROVIDER,
};

export function providerById(id: ProviderId): PredictionProvider {
  return ALL[id];
}
