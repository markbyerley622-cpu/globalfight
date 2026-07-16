import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Backfill fight cards + results from Wikipedia (CC BY-SA) for past events with
// no card. Promotion-agnostic; the only source carrying bout winners/method for
// BKFC/ONE. Gated by ENABLE_SCRAPER + the "wikipedia-facts" registry entry.
export const GET = makeCronHandler("wikicards");
