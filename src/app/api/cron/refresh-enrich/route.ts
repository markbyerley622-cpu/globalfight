import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Fighter profile enrichment (photos + bio) for new/stale fighters. Hourly —
// each run drains a bounded batch (ENRICH_BATCH), so the backlog clears over
// time and every fighter is rechecked at least every ENRICH_STALE_DAYS.
export const GET = makeCronHandler("enrich");
