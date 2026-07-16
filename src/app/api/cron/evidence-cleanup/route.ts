import { NextResponse } from "next/server";
import { cleanupExpiredEvidence } from "@/lib/evidence/lifecycle";
import { purgeStaleResetTokens } from "@/lib/auth-password-reset";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Same authorization as the other cron routes: a Bearer secret, and in production
 * a missing secret means UNAUTHORIZED (fail closed) rather than open.
 */
function authorized(req: Request): boolean {
  const secret = process.env.SCRAPE_CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Retention sweep for identity documents. Runs daily.
 *
 * Deletes: approved claims' evidence that wasn't removed inline, rejected claims
 * past the appeal window, abandoned (never-reviewed) claims past their TTL, and
 * retries any deletion that previously FAILED.
 *
 * Also purges dead password-reset tokens.
 *
 * Returns counts only — never a key, never a URL, never a claimant.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  try {
    const evidence = await cleanupExpiredEvidence();
    const resetTokensPurged = await purgeStaleResetTokens();
    const durationMs = Date.now() - started;

    log.info({ ...evidence, resetTokensPurged, durationMs }, "cron:evidence-cleanup");

    // A non-zero stillFailing means documents we intended to destroy are still in
    // the bucket. Surface it as a non-200 so a monitor notices rather than a
    // green tick hiding retained passports.
    const status = evidence.stillFailing > 0 ? 500 : 200;
    return NextResponse.json({ ok: evidence.stillFailing === 0, ...evidence, resetTokensPurged, durationMs }, { status });
  } catch (e) {
    log.error({ err: (e as Error).message }, "cron:evidence-cleanup-failed");
    return NextResponse.json({ ok: false, error: "cleanup failed" }, { status: 500 });
  }
}
