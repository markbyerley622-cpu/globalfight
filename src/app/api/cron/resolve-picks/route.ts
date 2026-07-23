import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { resolveDuePicks } from "@/lib/intelligence/resolve";
import { resultOps } from "@/lib/intelligence/result-ops";
import { log } from "@/lib/scraper/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Combat Intelligence Engine entrypoint. Grades picks for every newly-decided
// bout and fans out reputation / collectibles / notifications / activity. Runs
// after refresh-results so results are fresh. Idempotent — safe to re-run.
//
// Also emits result-integrity telemetry every run: bouts that are over but still
// SCHEDULED (awaiting a result — the human review queue) and decided bouts whose
// picks never graded (resolution lag). A non-zero count is logged loudly so a
// stuck feed or a mis-slugged bout surfaces instead of silently owing payouts.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const out = await resolveDuePicks();
    const ops = await resultOps().catch(() => null);
    if (ops && (ops.awaitingResults > 0 || ops.resolutionLag > 0)) {
      log.warn(
        { op: "resolve-picks.ops", awaitingResults: ops.awaitingResults, resolutionLag: ops.resolutionLag,
          awaitingSample: ops.awaitingSample.slice(0, 5), lagSample: ops.lagSample.slice(0, 5) },
        "result-integrity: bouts awaiting results or picks awaiting resolution",
      );
    }
    return NextResponse.json({
      ok: true, kind: "resolve-picks", durationMs: Date.now() - started, ...out,
      awaitingResults: ops?.awaitingResults ?? null, resolutionLag: ops?.resolutionLag ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, kind: "resolve-picks", error: (e as Error).message }, { status: 500 });
  }
}
