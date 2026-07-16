// ════════════════════════════════════════════════════════════════════════
//  Wikipedia fight-card provider — public surface.
//
//  Promotion-agnostic card + RESULTS source (CC BY-SA, the licensed
//  "wikipedia-facts" entry). Fills the gap that bkfc.com and onefc.com leave:
//  neither exposes bout winners/method in static HTML.
//
//  Pure provider — syncWikiCards() returns canonical NormalizedEvent[]; the
//  caller persists via persistAggregated.
// ════════════════════════════════════════════════════════════════════════

export { syncWikiCards } from "./sync";
export { parseWikiCard, type WikiBout } from "./extract";
export { toNormalizedWikiEvent, toFightStub, WIKI_SOURCE } from "./map";
export type { WikiTarget, WikiHarvest, WikiHarvestReport } from "./types";
