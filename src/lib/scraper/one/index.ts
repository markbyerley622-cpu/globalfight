// ════════════════════════════════════════════════════════════════════════
//  ONE Championship ingestion provider — public surface.
//
//  A JSON-LD-driven scraper for onefc.com events. Pure provider: syncONE()
//  returns canonical NormalizedEvent[] with a per-event sport (the "ONE Friday
//  Fights" series → MUAY_THAI / KICKBOXING). The shared pipeline persists.
//  Fetching gated by ENABLE_SCRAPER; writing gated by the "one-*" registry
//  entries (enforced in the runner).
// ════════════════════════════════════════════════════════════════════════

export { syncONE } from "./sync";
export { discoverEvents } from "./sitemap";
export { toNormalizedOneEvent, ONE_SOURCE } from "./map";
export { detectOneSport } from "./extract/events";
export type { SyncOptions, OneHarvest, OneEvent, OneSport } from "./types";
