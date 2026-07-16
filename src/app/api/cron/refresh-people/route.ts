import { makeCronHandler } from "@/lib/scraper/cron-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "people" directory → Fighter rows. Retired no-op: this was BoxRec-sourced and
// BoxRec has been removed. Fighter rows now come from the licensed API providers
// (src/services) + the mock-data layer. Route kept so the cron schedule is stable.
export const GET = makeCronHandler("people");
