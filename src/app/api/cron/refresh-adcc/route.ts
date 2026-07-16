import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ADCC (adcombat.com) → BJJ / submission-grappling Event rows. Gated: writes
// nothing unless "adcc-events" is enabled and ENABLE_SCRAPER=true.
export const GET = makeCronHandler("adcc");
