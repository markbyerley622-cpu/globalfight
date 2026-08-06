import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { COMMIT_SHA, COMMIT_SHORT, APP_ENV, uptimeSeconds } from "@/lib/observability/version";
import { errorReportingEnabled } from "@/lib/observability/report";
import { scannerHealth } from "@/lib/media/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + readiness probe. Checks DB connectivity so a platform health check
// (Render `healthCheckPath`, a load balancer) can gate traffic on a working
// database rather than just a booting process. Returns 200 when healthy, 503
// when the DB is unreachable. Only up/down is exposed — never internal detail.
//
// ── Extended with WHICH BUILD and HOW LONG ──────────────────────────────────
// The probe answered "is it serving?" but not "is it serving the thing we just
// shipped?". During an incident that is the first question, and without a commit
// SHA the only way to answer it was to trust the deploy log. `uptimeSeconds` is
// the other half: a service that keeps restarting reports healthy on every poll,
// and a resetting uptime is the only signal in the response that shows it.
//
// Still UNAUTHENTICATED, so it is written as if hostile eyes read every field. A
// failing dependency reports "down" and nothing else — no driver message, no
// host, no connection string. The detail goes to the error reporter, which is
// authenticated. The commit SHA is deliberately public: knowing which build is
// live is the point, and the repository already publishes it.

type CheckState = "up" | "down" | "skipped";
interface Check { state: CheckState; ms: number | null }

/** Bound the probe: a hung dependency must not hang the health check itself. */
const TIMEOUT_MS = 3_000;

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const startedAt = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return { state: "up", ms: Date.now() - startedAt };
  } catch {
    return { state: "down", ms: Date.now() - startedAt };
  }
}

export async function GET() {
  // The cheapest statement that proves the pool works end to end. A count() on a
  // real table would also exercise the schema, but it turns a probe polled every
  // few seconds into a repeated scan.
  const database = await timed(() => prisma.$queryRaw`SELECT 1`);

  // Redis is OPTIONAL — the rate limiter falls back to an in-process store — so
  // its absence is "skipped", not "down". Reporting degraded for a dependency
  // the app is designed to run without trains whoever is on call to ignore this
  // endpoint, which is the worst outcome for a health check.
  const cache: Check = process.env.REDIS_URL ? { state: "up", ms: null } : { state: "skipped", ms: null };

  // Configuration-only. A round-trip to the bucket on every poll would cost
  // money and prove little; the startup guard already refuses to boot in
  // production without these set.
  const storage: Check = process.env.EVIDENCE_R2_BUCKET ? { state: "up", ms: null } : { state: "skipped", ms: null };

  // The malware scanner. Reported but NOT required for `healthy`: with no
  // scanner the app is fully functional and simply refuses media uploads, which
  // is a degraded feature rather than a down service. Making it required would
  // take the whole site out of the load balancer over an image upload path.
  //
  // Neither the URL nor the token is ever exposed — only whether it is
  // configured, which provider, and whether it answers.
  const scanner = await scannerHealth();

  // REQUIRED = the database. Everything else degrades rather than fails.
  const healthy = database.state === "up";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      // `db` and `latencyMs` are kept at the top level: the previous shape is
      // what any existing monitor is already parsing, and silently renaming
      // fields in a health response is how an alert stops firing.
      db: database.state,
      latencyMs: database.ms,
      version: { commit: COMMIT_SHA, short: COMMIT_SHORT, env: APP_ENV },
      uptimeSeconds: uptimeSeconds(),
      checks: { database, cache, storage },
      mediaScanner: scanner,
      // Whether telemetry is actually wired. A silently-unconfigured reporter is
      // the exact failure this sprint exists to prevent, so it is visible here
      // rather than discovered during an incident.
      errorReporting: errorReportingEnabled() ? "configured" : "console-only",
      ts: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store, max-age=0" },
    },
  );
}
