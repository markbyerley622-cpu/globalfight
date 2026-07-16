import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ONE Championship (onefc.com) → Event rows, sport per-event (Friday Fights →
// MUAY_THAI / KICKBOXING). Gated: writes nothing unless "one-events" is enabled
// in the ingestion registry and ENABLE_SCRAPER=true.
export const GET = makeCronHandler("one");
