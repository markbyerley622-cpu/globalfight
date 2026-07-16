import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Upcoming events — every 2 hours.
export const GET = makeCronHandler("events");
