import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ONE Championship (onefc.com) → Event rows, sport per-event (Friday Fights →
// MUAY_THAI / KICKBOXING). The "one-events" registry gate was removed
// (2026-08-01); ENABLE_SCRAPER=true is the only remaining condition.
export const GET = makeCronHandler("one");
