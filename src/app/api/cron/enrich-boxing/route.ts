import { NextResponse } from "next/server";
import { enrichBoxingFighters } from "@/services/sync/enrich-boxing-fighters";
import { log } from "@/lib/scraper/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily incremental boxing-fighter enrichment. Each run fills physical stats +
// records for a bounded batch of BOXING fighters via the Boxing Data API
// (search-by-name, 1 request each), oldest-touched first — so the whole roster
// is covered over successive days while staying under the RapidAPI free-tier
// quota (~500/month). Tune the batch with BOXING_ENRICH_LIMIT (default 15).
//
// Auth matches the other cron routes: Vercel Cron's `Authorization: Bearer
// <SCRAPE_CRON_SECRET>`, or an `x-cron-secret` header for manual triggers.
function authorized(req: Request): boolean {
  const secret = process.env.SCRAPE_CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.headers.get("x-cron-secret") === secret
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const envLimit = Number(process.env.BOXING_ENRICH_LIMIT ?? 15);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? envLimit) || envLimit, 50);

  const started = Date.now();
  try {
    const out = await enrichBoxingFighters(limit);
    const durationMs = Date.now() - started;
    log.info({ ...out, limit, durationMs }, "cron:enrich-boxing:done");
    return NextResponse.json({ ok: true, action: "enrich-boxing-fighters", limit, durationMs, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
