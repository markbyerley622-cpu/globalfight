import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Fight results — every hour.
export const GET = makeCronHandler("results");
