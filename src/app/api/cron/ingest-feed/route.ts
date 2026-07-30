// GET /api/cron/ingest-feed — refresh the Combat Feed catalog from channel RSS.
// Auth via the SHARED cronAuthorized, which accepts SCRAPE_CRON_SECRET *or*
// CRON_SECRET. This route used to accept only the former while every Render
// cron service sends the latter — so scheduling it would have produced a 401
// every hour, swallowed by the `|| true` in the cron startCommand. That is the
// same silent failure /api/cron/sync shipped with once already.
import { NextResponse } from "next/server";
import { ingestOnce } from "@/lib/feed/ingest";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { runJob } from "@/lib/scraper/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;


export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // runJob records the run in ScrapeJob so /admin/health can see this job at all.
  // `ingestOnce` reports failure in-band via `result.error` rather than throwing,
  // so re-throw it — otherwise every run is filed as a SUCCESS and the health
  // dashboard repeats the exact lie this work is removing.
  try {
    const result = await runJob("feed:ingest", async () => {
      const r = await ingestOnce();
      if (r.error) throw new Error(r.error);
      return r;
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
