// ════════════════════════════════════════════════════════════════════════
//  ADCC (BJJ) ingestion provider — public surface.
//  Pure provider: syncADCC() returns canonical NormalizedEvent[] (sport BJJ)
//  from adcombat.com. The shared pipeline persists. Fetching gated by
//  ENABLE_SCRAPER; writing by the "adcc-events" ingestion-registry entry.
// ════════════════════════════════════════════════════════════════════════

export { syncADCC } from "./sync";
export { toNormalizedAdccEvent, ADCC_SOURCE, ADCC_SPORT } from "./map";
export { parseAdccEventsPage } from "./extract";
export type { SyncOptions, AdccHarvest, AdccEvent } from "./types";
