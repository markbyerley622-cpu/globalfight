// ════════════════════════════════════════════════════════════════════════
//  Promotion event-index provider — for promotions with NO API, NO public JSON
//  and NO embedded JSON, whose card history Wikipedia nonetheless indexes.
//
//  TWO source shapes, because promotions are written up two ways:
//
//    index path (sync.ts)      one article PER CARD, discovered from a numbered
//                              index. Misfits Boxing.
//    year path  (year-sync.ts) NO per-card article — every card in a season
//                              shares one round-up, split back apart by
//                              year-split.ts. ONE Championship, GLORY.
//
//  The year path exists because the index path's shared-article guard correctly
//  refuses a round-up, and wikicard's verifier correctly rejects it too. Neither
//  was loosened; the missing capability was added instead.
//
//  Both reuse the wikicard extractor for the card itself; this module only adds
//  DISCOVERY (which cards exist, when, and where).
// ════════════════════════════════════════════════════════════════════════

export { parseEventIndex, type IndexedEvent } from "./parse";
export {
  PROMOTION_INDEX_SOURCES, indexSourceFor, type PromotionIndexSource,
  YEAR_PAGE_SOURCES, yearSourceFor, yearPageTitle, type YearPageSource,
} from "./config";
export {
  syncPromotionIndex, articleFromExternalId, INDEX_SOURCE, INDEX_CONFIDENCE,
  type IndexHarvest, type IndexSyncOpts, type IndexReport,
} from "./sync";
export { splitYearPage, type YearPageSection } from "./year-split";
export {
  syncYearPages, sectionKey, eventMatchKey, pageFromExternalId, YEAR_SOURCE, YEAR_CONFIDENCE,
  type YearHarvest, type YearSyncOpts, type YearReport, type SectionKey,
} from "./year-sync";
