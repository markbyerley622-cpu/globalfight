// Structured logging for the predictions feature — reuses the repo's logger so
// provider refreshes land in the same pipeline as ingestion/feed events.
import { log } from "@/lib/scraper/logger";

export const plog = log.child({ svc: "predictions" });
