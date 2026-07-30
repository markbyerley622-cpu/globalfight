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
export {
  findWikiTargets, findWikiTargetForFight, countWikiGaps, recordResultAttempts, RESULT_BACKFILL_DAYS,
  type WikiGap, type WikiMode, type FindTargetsOpts,
} from "./targets";
export {
  buildSearchLadder, isSyntheticEventName,
  type SearchStrategy, type SearchStrategyKind,
} from "./search-strategies";
export { verifyCard, isAcceptable, type ExpectedBout, type VerifiedMatch } from "./verify";
export type {
  WikiTarget, EventIdentity, WikiHarvest, WikiHarvestReport, WikiTargetOutcome, TraceStep,
} from "./types";
