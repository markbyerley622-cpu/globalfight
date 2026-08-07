import "server-only";
import { prisma } from "@/lib/db";
import { HEARTBEAT_MS } from "./derive";

// ════════════════════════════════════════════════════════════════════════════
//  Presence — the write side.
//
//  Deliberately tiny. The read side is a pure function of a timestamp
//  (lib/presence/derive), so all this has to do is keep that timestamp fresh
//  without turning a heartbeat into a meaningful database load.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Record that this user is here.
 *
 * ── Throttled in the WHERE clause, not in the application ─────────────────
 * `updateMany` with a "…or older than one interval" guard means the common
 * case — a beat arriving while the row is already fresh — matches zero rows and
 * writes nothing. Doing the same check as a read-then-write would double the
 * round-trips and still race two of the user's own tabs into a lost update.
 *
 * With several tabs open this is one cheap indexed UPDATE per user per
 * interval no matter how many of them are beating, because whichever tab wins
 * makes the row fresh for all the others.
 *
 * Never throws: presence is ambient. A failed heartbeat must not surface as an
 * error on a surface the user is only trying to read.
 */
export async function heartbeat(userId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - HEARTBEAT_MS);
  try {
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }],
      },
      data: { lastSeenAt: new Date() },
    });
  } catch {
    /* ambient — see above */
  }
}
