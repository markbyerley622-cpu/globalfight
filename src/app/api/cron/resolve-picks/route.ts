import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { resolveDuePicks } from "@/lib/intelligence/resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Combat Intelligence Engine entrypoint. Grades picks for every newly-decided
// bout and fans out reputation / collectibles / notifications / activity. Runs
// after refresh-results so results are fresh. Idempotent — safe to re-run.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const out = await resolveDuePicks();
    return NextResponse.json({ ok: true, kind: "resolve-picks", durationMs: Date.now() - started, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, kind: "resolve-picks", error: (e as Error).message }, { status: 500 });
  }
}
