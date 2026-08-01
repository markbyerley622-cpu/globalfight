// ════════════════════════════════════════════════════════════════════════
//  Tournament provider — bouts for the sports that publish a BRACKET rather
//  than a fight card: wrestling, taekwondo, judo, sambo, BJJ.
//
//  LOCAL ONLY. Nothing here is wired into runner.ts or any cron route; the entry
//  point is `npm run bouts:fill`. Wire it in once the parsers have been run
//  against enough real pages to trust unattended.
//
//  Fetching goes through the shared honest client (ENABLE_SCRAPER, identifying
//  UA, throttle). Writing is the caller's job via persistAggregated.
// ════════════════════════════════════════════════════════════════════════

export { parseBrackets } from "./bracket";
export { parseMedalFinals, type MedalFinal } from "./medals";
export { TOURNAMENT_SOURCES, sourceFor, type TournamentSource } from "./config";
export { toNormalizedEvent, toFightStub, TOURNAMENT_SOURCE, TOURNAMENT_CONFIDENCE } from "./map";
export { syncTournaments, type TournamentHarvest, type TournamentSyncOpts } from "./sync";
export { parseWikiDate, pageMeta, subArticles, wikiPage, disambiguateName } from "./wiki";
export { tableGrid, type GridCell } from "./grid";
export type { TournamentBout, TournamentCard, TournamentReport } from "./types";
