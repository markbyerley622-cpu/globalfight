// GET /api/cron/ingest-feed — refresh the Combat Feed catalog from channel RSS.
// Auth via the SHARED cronAuthorized, which accepts SCRAPE_CRON_SECRET *or*
// CRON_SECRET. This route used to accept only the former while every Render
// cron service sends the latter — so scheduling it would have produced a 401
// every hour, swallowed by the `|| true` in the cron startCommand. That is the
// same silent failure /api/cron/sync shipped with once already.
import { NextResponse } from "next/server";
import { ingestOnce } from "@/lib/feed/ingest";
import { cronAuthorized } from "@/lib/scraper/cron-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;


export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await ingestOnce();
  return NextResponse.json({ ok: !result.error, ...result });
}
