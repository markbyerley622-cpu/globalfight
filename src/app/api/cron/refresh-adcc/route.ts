import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ADCC (adcombat.com) → BJJ / submission-grappling Event rows. The "adcc-events"
// registry gate was removed (2026-08-01); ENABLE_SCRAPER=true is the only
// remaining condition.
export const GET = makeCronHandler("adcc");
