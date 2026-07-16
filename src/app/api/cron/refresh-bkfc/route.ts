import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
// BKFC's archive is large; give the run headroom. It still self-caps via
// BKFC_MAX_PAGES and is a no-op unless ENABLE_SCRAPER=true.
export const maxDuration = 300;

// bkfc.com → Event/Fight/Fighter/Ranking/Article/FeedVideo (sport=BARE_KNUCKLE).
// Gated: writes nothing unless the "bkfc-*" ingestion sources are enabled with
// a legal basis (see src/lib/ingestion-registry.ts). Otherwise a dry-run.
export const GET = makeCronHandler("bkfc");
