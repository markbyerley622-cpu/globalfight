// ════════════════════════════════════════════════════════════════════════
//  Promotion event-index provider — for promotions with NO API, NO public JSON
//  and NO embedded JSON, whose card history Wikipedia nonetheless indexes.
//
//  Currently: Misfits Boxing. Each entry in config.ts records the source ladder
//  that was actually walked before landing here.
//
//  Reuses the wikicard extractor for the card itself; this module only adds
//  DISCOVERY (which cards exist, when, and where).
// ════════════════════════════════════════════════════════════════════════

export { parseEventIndex, type IndexedEvent } from "./parse";
export { PROMOTION_INDEX_SOURCES, indexSourceFor, type PromotionIndexSource } from "./config";
export {
  syncPromotionIndex, articleFromExternalId, INDEX_SOURCE, INDEX_CONFIDENCE,
  type IndexHarvest, type IndexSyncOpts, type IndexReport,
} from "./sync";
