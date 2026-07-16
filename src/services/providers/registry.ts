// Single source of truth for the installed API providers. The aggregator and
// admin dashboard both read from here.
//
// Only licensed / properly-documented data sources are registered. Removed for
// licensing/compliance reasons:
//   • ESPN hidden JSON API — undocumented private endpoint, no key, no licence.
//   • Tapology (unofficial RapidAPI) — third-party scrape of Tapology, unlicensed.
//   • Sportbex — no publication licence; kept disabled (dormant stub only).
//
// Each remaining provider stays dormant until its own API key/token is set.

import type { CombatDataProvider } from "./types";
import type { Sport } from "@/lib/types";
import { ApiSportsProvider } from "./api-sports";
import { SportradarProvider } from "./sportradar";
import { BoxingDataProvider } from "./boxing-data";
import { DsgProvider } from "./dsg";
import { FightAnalyticsProvider } from "./fightanalytics";

export const PROVIDERS: readonly CombatDataProvider[] = [
  new ApiSportsProvider(),       // MMA — licensed API (key-gated)
  new BoxingDataProvider(),      // Boxing — licensed API (key-gated)
  new SportradarProvider(),      // MMA + Boxing — enterprise licence
  new DsgProvider(),             // Taekwondo / Judo / Wrestling / Boxing / MMA
  new FightAnalyticsProvider(),  // 7 disciplines + per-round stats (licensed trial)
];

export function getProvider(key: string): CombatDataProvider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

/** Providers that cover a sport, in declaration order (priority applied later). */
export function providersForSport(sport: Sport): CombatDataProvider[] {
  return PROVIDERS.filter((p) => p.sports.includes(sport));
}

/** Configured providers only. */
export function configuredProviders(): CombatDataProvider[] {
  return PROVIDERS.filter((p) => p.isConfigured());
}
