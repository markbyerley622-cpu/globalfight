// Structured logging for the Combat Feed — reuses the repo's pino logger so feed
// events land in the same log pipeline (Datadog/Logtail/etc.) as ingestion.
import { log } from "@/lib/scraper/logger";

export const flog = log.child({ svc: "feed" });
