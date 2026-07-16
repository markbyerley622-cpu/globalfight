import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Current UFC roster (Wikipedia) → Fighter rows with sport=MMA. Daily.
export const GET = makeCronHandler("mma");
