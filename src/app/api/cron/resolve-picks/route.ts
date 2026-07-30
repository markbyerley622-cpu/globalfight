import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { runJob } from "@/lib/scraper/runner";
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
    // Wrapped in runJob so this run appears in the ScrapeJob history that
    // /admin/health reads. Settlement is the payoff half of the habit loop; it was
    // the one job with no run record at all.
    const out = await runJob("picks:resolve", () => resolveDuePicks());
    // Telemetry runs AFTER reconciliation, so the numbers describe what is still
    // broken rather than what this run was about to fix. unsettledPicks is the
    // invariant: a decisive result with an ungraded pick means payouts are owed, and
    // if it is non-zero here — immediately after the reconciler ran — something is
    // failing rather than merely lagging. That distinction was not observable before.
    const ops = await resultOps().catch(() => null);
    if (ops && (ops.unsettledPicks > 0 || ops.unsettledBattles > 0)) {
      log.error(
        { op: "resolve-picks.drift", unsettledPicks: ops.unsettledPicks,
          unsettledBattles: ops.unsettledBattles, lagSample: ops.lagSample.slice(0, 5) },
        "INVARIANT VIOLATED: decided bouts still carry ungraded picks after reconciliation",
      );
    }
    if (ops && ops.awaitingResults > 0) {
      log.warn(
        { op: "resolve-picks.ops", awaitingResults: ops.awaitingResults,
          awaitingSample: ops.awaitingSample.slice(0, 5) },
        "bouts are over with no ingested result — the results feed, not settlement",
      );
    }
    return NextResponse.json({
      ok: true, kind: "resolve-picks", durationMs: Date.now() - started, ...out,
      awaitingResults: ops?.awaitingResults ?? null, resolutionLag: ops?.resolutionLag ?? null,
      unsettledPicks: ops?.unsettledPicks ?? null, unsettledBattles: ops?.unsettledBattles ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, kind: "resolve-picks", error: (e as Error).message }, { status: 500 });
  }
}
