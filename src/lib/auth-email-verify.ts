// ════════════════════════════════════════════════════════════════════════
//  Email-address verification, by short numeric code.
//
//  Deliberately shaped like `auth-password-reset.ts` — same hashing, same
//  supersede-on-reissue, same "return the raw secret only to the caller that
//  mails it" rule — because they are the same concept with different payloads
//  and the codebase should not grow two token idioms.
//
//  The one real difference is entropy. A reset token is 256 random bits; a
//  6-digit code is ~20, which is guessable in a million tries. So the code is
//  NOT the whole control:
//
//    • Bound to a session. Both endpoints require an authenticated user and the
//      code is looked up BY userId, never by code. There is no request an
//      anonymous attacker can make that tries a code against "some account" —
//      which is the attack that makes short codes dangerous.
//    • Attempt-capped. MAX_ATTEMPTS wrong guesses burns the token; a new one
//      must be sent. That caps a single token at 5-in-a-million.
//    • Short-lived. TTL_MINUTES, so an abandoned code is not left standing.
//    • Cooldown on reissue, enforced here rather than in the UI, so holding the
//      resend button cannot be used to spray codes (or to mail-bomb a user).
//
//  Verification is RECORDED, not ENFORCED. Nothing gates on `emailVerified`
//  yet, and that is intentional: every account that predates this feature has
//  a null value, so gating login or posting on it would lock out the entire
//  existing user base on deploy. Gate new surfaces on `isEmailVerified()` when
//  there is a backfill or a grandfather date to go with it.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

/** Long enough to switch to a mail app and back, short enough to matter. */
export const VERIFY_TTL_MINUTES = 15;
/** Wrong guesses before the code is burned and a new one must be requested. */
export const MAX_ATTEMPTS = 5;
/** Server-enforced gap between sends, in seconds. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Digits in the emailed code. */
const CODE_DIGITS = 6;

/**
 * Salted with `userId` so two users who happen to draw the same code do not
 * share a hash, and a hash lifted from one row cannot be replayed against
 * another account.
 */
export function hashCode(code: string, userId: string): string {
  return createHash("sha256").update(`${code}:${userId}`).digest("hex");
}

/**
 * `randomInt` is the CSPRNG, not `Math.random`. Padded rather than generated in
 * the 100000–999999 range so that codes beginning with zero are possible — a
 * range that silently excludes a tenth of the space is a weaker code for no
 * reason.
 */
function newCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

export type IssueResult =
  | { ok: true; code: string; email: string }
  | { ok: false; reason: "NO_EMAIL" | "ALREADY_VERIFIED" | "COOLDOWN"; retryAfter?: number };

/**
 * Mint a verification code for `userId`, superseding any outstanding one.
 *
 * Returns the RAW code. It exists only here and in the email — never stored,
 * never logged, never returned to an HTTP client.
 */
export async function issueVerificationCode(
  userId: string,
  requestIp: string | null,
): Promise<IssueResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user?.email) return { ok: false, reason: "NO_EMAIL" };
  if (user.emailVerified) return { ok: false, reason: "ALREADY_VERIFIED" };

  // Cooldown is measured from the newest live token, so a caller cannot bypass
  // it by racing two requests — the second sees the first's `sentAt`.
  const latest = await prisma.emailVerificationToken.findFirst({
    where: { userId, usedAt: null },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (latest) {
    const elapsed = (Date.now() - latest.sentAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return { ok: false, reason: "COOLDOWN", retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
    }
  }

  const code = newCode();
  const now = new Date();

  await prisma.$transaction([
    // Supersede: the previous code stops working the instant a new one is sent,
    // so a user reading two emails cannot be confused about which is live.
    prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.emailVerificationToken.create({
      data: {
        userId,
        email: user.email,
        codeHash: hashCode(code, userId),
        expiresAt: new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000),
        sentAt: now,
        requestIp,
      },
    }),
  ]);

  return { ok: true, code, email: user.email };
}

export type VerifyFailure = "INVALID" | "EXPIRED" | "USED" | "NO_CODE" | "TOO_MANY_ATTEMPTS" | "EMAIL_CHANGED";
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure; attemptsLeft?: number };

/**
 * Redeem a code for the signed-in user.
 *
 * Looked up by `userId` — never by code — so there is no query shape here that
 * an attacker can point at an account they do not already hold a session for.
 */
export async function redeemVerificationCode(userId: string, rawCode: string): Promise<VerifyResult> {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "INVALID" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (user?.emailVerified) return { ok: true }; // idempotent — double-submit is not an error

  const row = await prisma.emailVerificationToken.findFirst({
    where: { userId, usedAt: null },
    orderBy: { sentAt: "desc" },
    select: { id: true, codeHash: true, email: true, expiresAt: true, attempts: true },
  });
  if (!row) return { ok: false, reason: "NO_CODE" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };
  // A code proves control of the address it was SENT to. If the account's email
  // changed in between, this code no longer proves anything about the new one.
  if (!user?.email || user.email !== row.email) return { ok: false, reason: "EMAIL_CHANGED" };

  const a = Buffer.from(row.codeHash, "hex");
  const b = Buffer.from(hashCode(code, userId), "hex");
  const match = a.length === b.length && timingSafeEqual(a, b);

  if (!match) {
    // Count the failure BEFORE returning, so a client that ignores the response
    // and hammers the endpoint still burns its allowance.
    const { attempts } = await prisma.emailVerificationToken.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);
    return { ok: false, reason: attemptsLeft === 0 ? "TOO_MANY_ATTEMPTS" : "INVALID", attemptsLeft };
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } }),
    prisma.auditLog.create({
      data: { actorId: userId, action: "auth.email.verified", entity: "User", entityId: userId },
    }),
  ]);

  return { ok: true };
}

/** Has this user proven control of their address? Nothing gates on this yet. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  return Boolean(u?.emailVerified);
}

/** The message body. Kept beside the issuing logic so the TTL cannot drift. */
export function verificationEmail(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your Combat Reviews verification code`,
    text: [
      `Your verification code is ${code}`,
      "",
      `It expires in ${VERIFY_TTL_MINUTES} minutes.`,
      "",
      "If you didn't create a Combat Reviews account, you can ignore this email —",
      "the address will not be used until someone enters this code.",
    ].join("\n"),
  };
}

/** Housekeeping: drop codes that are long dead. Safe to run repeatedly. */
export async function purgeStaleVerificationTokens(
  olderThan: Date = new Date(Date.now() - 7 * 24 * 60 * 60_000),
): Promise<number> {
  const { count } = await prisma.emailVerificationToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: olderThan } }, { usedAt: { lt: olderThan } }] },
  });
  return count;
}
