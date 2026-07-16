import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Divisional rankings — every 6 hours (see vercel.json).
export const GET = makeCronHandler("rankings");
