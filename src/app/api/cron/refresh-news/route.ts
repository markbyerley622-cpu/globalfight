import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Breaking news — every 15 minutes (news feed ingestion, not the data source).
export const GET = makeCronHandler("news");
