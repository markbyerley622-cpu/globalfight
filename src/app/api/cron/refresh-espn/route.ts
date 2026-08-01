import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ESPN MMA scoreboard → UFC / PFL / Bellator / ONE / RIZIN cards WITH results.
//
// CURRENT YEAR ONLY, by design: this settles last night's card and picks up the
// next announcements. A promotion's back catalogue does not change, so history is
// `npm run espn:backfill`, run deliberately rather than hourly.
//
// One request per league (5), so it is cheap enough to run often. Requires
// ENABLE_SCRAPER=true like every other fetch.
export const GET = makeCronHandler("espn");
