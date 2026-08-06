import { NextResponse } from "next/server";
import { cleanupExpiredEvidence } from "@/lib/evidence/lifecycle";
import { cleanupExpiredIdentityDocuments } from "@/lib/identity-verification";
import { purgeStaleResetTokens } from "@/lib/auth-password-reset";
import { cleanupMedia } from "@/lib/media/asset/lifecycle";
import { log } from "@/lib/scraper/logger";
import { cronAuthorized } from "@/lib/scraper/cron-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Same authorization as the other cron routes: a Bearer secret, and in production
 * a missing secret means UNAUTHORIZED (fail closed) rather than open.
 */

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
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  try {
    const evidence = await cleanupExpiredEvidence();
    // Identity documents live in their own table, so the claim sweep above does
    // not see them. Without this they would be retained forever.
    const identity = await cleanupExpiredIdentityDocuments();
    const resetTokensPurged = await purgeStaleResetTokens();
    // Public media joins the retention sweep rather than getting its own cron.
    // It IS a retention job (abandoned uploads, unreferenced assets, expired
    // quarantine), it runs daily like the rest of this route, and a second cron
    // service would be a second schedule to keep in step across vercel.json AND
    // render.yaml. OPERATIONS.md flagged "cleanupMedia is not scheduled" as a
    // ship blocker; this is that wire.
    //
    // Idempotent by construction, and it only MARKS rows DELETED — byte removal
    // is a separate concern, so a bug here can never destroy a live asset's
    // storage. That is why it is safe to bolt onto an existing job.
    const media = await cleanupMedia();
    const durationMs = Date.now() - started;

    log.info({ ...evidence, identity, media, resetTokensPurged, durationMs }, "cron:evidence-cleanup");

    // A non-zero stillFailing means documents we intended to destroy are still in
    // the bucket. Surface it as a non-200 so a monitor notices rather than a
    // green tick hiding retained passports.
    // Same rule for identity documents: a failed delete is a retained passport,
    // so it must not report green either.
    const failing = evidence.stillFailing > 0 || identity.failed > 0;
    const status = failing ? 500 : 200;
    return NextResponse.json(
      { ok: !failing, ...evidence, identity, media, resetTokensPurged, durationMs },
      { status },
    );
  } catch (e) {
    log.error({ err: (e as Error).message }, "cron:evidence-cleanup-failed");
    return NextResponse.json({ ok: false, error: "cleanup failed" }, { status: 500 });
  }
}
