import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Champions — every 6 hours.
export const GET = makeCronHandler("champions");
