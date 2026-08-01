import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
// BKFC's archive is large; give the run headroom. It still self-caps via
// BKFC_MAX_PAGES and is a no-op unless ENABLE_SCRAPER=true.
export const maxDuration = 300;

// bkfc.com → Event/Fight/Fighter/Ranking/Article/FeedVideo (sport=BARE_KNUCKLE).
// The "bkfc-*" registry gate was removed (2026-08-01), so this is no longer a
// dry-run: with ENABLE_SCRAPER=true it writes everything the runner hands to
// persistAggregated. src/lib/ingestion-registry.ts still records the terms.
export const GET = makeCronHandler("bkfc");
