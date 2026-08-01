// ════════════════════════════════════════════════════════════════════════
//  ESPN MMA provider — full cards WITH results for UFC, PFL, Bellator, ONE,
//  RIZIN, KSW, Cage Warriors, Invicta, LFA, K-1 and the defunct majors.
//
//  Public JSON scoreboard, one request per league-year, whole card inline.
//  Fetching goes through the shared honest client (ENABLE_SCRAPER, identifying
//  UA, throttle); writing is the caller's job via persistAggregated.
//
//  Entry points: `npm run espn:backfill` (historical) and the `espn` runner kind
//  behind /api/cron/refresh-espn (recent).
// ════════════════════════════════════════════════════════════════════════

export { ESPN_LEAGUES, DEFAULT_LEAGUE_KEYS, leagueFor, type EspnLeague } from "./leagues";
export { syncEspn, type EspnHarvest, type EspnSyncOpts } from "./sync";
export { toNormalizedEvent, toFightStub, normalizeWeightClass, ESPN_SOURCE, ESPN_CONFIDENCE } from "./map";
export type { EspnEvent, EspnCompetition, EspnScoreboard, EspnReport } from "./types";
