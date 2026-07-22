import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  Cross-instance job leases.
//
//  This replaces pg_try_advisory_lock, which was silently broken here and had
//  taken feed ingestion offline: advisory locks are SESSION-scoped, and Prisma
//  hands out pooled connections. `pg_try_advisory_lock` ran on one connection
//  and the matching `pg_advisory_unlock` in the finally block frequently ran on
//  another, where it is a no-op returning false. The lock then stayed held for
//  the life of that pooled connection, so every later ingest took the "another
//  instance holds the lock" branch and returned {skipped:true} — for the rest
//  of the process's life. Measured: run 1 ingested 223 videos, runs 2 and 3
//  skipped, and pg_locks showed the advisory lock still granted.
//
//  A lease row has none of that coupling. It is ordinary MVCC data, so it does
//  not care which connection touches it; it EXPIRES, so a crash mid-job cannot
//  wedge the job forever the way a leaked lock does; and it is inspectable with
//  a SELECT when someone asks why a cron went quiet.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Run `fn` if this instance can take the named lease.
 *
 * The claim is a single conditional UPDATE — `WHERE expiresAt < now()` — so the
 * database decides the winner and two instances racing cannot both proceed.
 * Returns null without running when the lease is already held.
 */
export async function withLease<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);

  let held = false;
  try {
    // INSERT … ON CONFLICT DO UPDATE … WHERE — the only form that both creates
    // the row on first use and claims it atomically, in one round trip.
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      INSERT INTO "JobLease" ("name", "expiresAt")
      VALUES (${name}, ${until})
      ON CONFLICT ("name") DO UPDATE SET "expiresAt" = ${until}
        WHERE "JobLease"."expiresAt" < ${now}
      RETURNING "name"
    `;
    held = rows.length > 0;
  } catch {
    // No lease table / DB unreachable: refuse rather than risk two instances
    // doing the same work. There is nowhere to persist the result anyway.
    return null;
  }
  if (!held) return null;

  try {
    return await fn();
  } finally {
    // Release early so the next scheduled run isn't blocked by the TTL. Failing
    // to release is survivable precisely because the lease expires.
    await prisma.jobLease
      .update({ where: { name }, data: { expiresAt: new Date() } })
      .catch(() => {});
  }
}
