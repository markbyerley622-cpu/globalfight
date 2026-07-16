import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Live bookmaker odds (licensed odds feed) — every 30 minutes.
export const GET = makeCronHandler("odds");
