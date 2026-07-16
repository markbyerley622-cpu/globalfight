// ════════════════════════════════════════════════════════════════════════
//  BKFC ingestion provider — public surface.
//
//  A Webflow-site scraper for bkfc.com that emits the repository's canonical
//  Normalized* entities (sport = BARE_KNUCKLE). It is a PURE data provider:
//  acquisition + transformation only. Persistence, dedupe, provenance and
//  snapshots belong to the shared ingestion pipeline (services/sync). The
//  runner calls syncBKFC() and hands the result to persistAggregated().
//
//  Fetching is gated by ENABLE_SCRAPER; writing is gated by the "bkfc-*"
//  ingestion-registry entries (enforced in the runner, not here).
// ════════════════════════════════════════════════════════════════════════

export { syncBKFC } from "./sync";
export { discover } from "./sitemap";
export {
  toNormalizedEvent,
  toNormalizedFighter,
  toNormalizedRanking,
  toNormalizedArticle,
  BKFC_SOURCE,
  BKFC_SPORT,
} from "./map";
export type {
  SyncOptions,
  SyncMode,
  BkfcEntity,
  BkfcHarvest,
  HarvestReport,
  BkfcEvent,
  BkfcFighter,
  BkfcBout,
  BkfcRankingRow,
  BkfcArticle,
  BkfcVideo,
} from "./types";
