// ════════════════════════════════════════════════════════════════════════
//  Forgotten-password reset.
//
//  Threat model driving each decision:
//    • DB leak → we store only sha256(token), so leaked rows yield no usable link.
//    • Token guessing → 32 random bytes; brute force is infeasible.
//    • Replay → single-use (`usedAt`), and issuing a new token consumes old ones.
//    • Account enumeration → the request endpoint returns the same body and the
//      same timing-insensitive shape whether or not the address exists.
//    • Stale sessions → a successful reset bumps the session epoch, so an
//      attacker holding a stolen cookie is signed out by the victim's reset.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword, revokeAllSessions } from "@/lib/auth";

/** Short-lived by design: long enough to read an email, short enough to matter. */
export const RESET_TTL_MINUTES = 30;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** URL-safe, 256 bits of entropy. */
function newRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Issue a reset token for `userId`. Consumes every prior unused token for that
 * user first, so only the most recent link ever works.
 *
 * Returns the RAW token — it exists only here and in the email. It is never
 * stored, logged, or returned to an HTTP client.
 */
export async function issueResetToken(userId: string, requestIp: string | null): Promise<string> {
  const raw = newRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
  const now = new Date();

  await prisma.$transaction([
    // Supersede: any outstanding token for this user stops working the moment a
    // new one is issued.
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt, requestIp },
    }),
  ]);

  return raw;
}

export type ResetFailure = "INVALID" | "EXPIRED" | "USED";
export type ResetResult = { ok: true; userId: string } | { ok: false; reason: ResetFailure };

/**
 * Redeem a reset token and set the new password.
 *
 * All failure modes return the same generic error to the caller — distinguishing
 * "expired" from "already used" tells an attacker their guess was structurally
 * right. The distinction is returned here for tests and audit, not for the UI.
 *
 * On success: the password is rehashed, the token is consumed, and EVERY session
 * for the user is revoked — all inside one transaction, so a crash cannot leave
 * the password changed but the old sessions alive.
 */
export async function redeemResetToken(rawToken: string, newPassword: string): Promise<ResetResult> {
  if (!rawToken || typeof rawToken !== "string") return { ok: false, reason: "INVALID" };

  const tokenHash = hashToken(rawToken);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, tokenHash: true },
  });

  if (!row) return { ok: false, reason: "INVALID" };

  // Constant-time compare on the hash. findUnique already matched it, so this is
  // belt-and-braces against any future lookup that isn't an exact-match index.
  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "INVALID" };

  if (row.usedAt) return { ok: false, reason: "USED" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        // Revoke every outstanding session for this user. This is the whole point
        // of a reset: whoever was in the account is now out.
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.auditLog.create({
      data: { actorId: row.userId, action: "auth.password.reset", entity: "User", entityId: row.userId },
    }),
  ]);

  return { ok: true, userId: row.userId };
}

/** Housekeeping: drop tokens that are long dead. Safe to run repeatedly. */
export async function purgeStaleResetTokens(olderThan: Date = new Date(Date.now() - 7 * 24 * 60 * 60_000)): Promise<number> {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: olderThan } }, { usedAt: { lt: olderThan } }] },
  });
  return count;
}

export { revokeAllSessions };
