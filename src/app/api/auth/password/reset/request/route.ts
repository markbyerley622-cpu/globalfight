import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { issueResetToken, RESET_TTL_MINUTES } from "@/lib/auth-password-reset";
import { sendEmail, isEmailConfigured, EmailNotConfiguredError } from "@/lib/email/send";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";
import { resolveSiteUrl } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Identical response for every outcome — see the enumeration note below. */
const GENERIC = { ok: true, message: "If that email is registered, we've sent a reset link." };

function resetUrl(rawToken: string): string {
  // Validated, so a malformed NEXT_PUBLIC_SITE_URL yields a working localhost
  // link rather than an unclickable one mailed to a real user.
  const base = resolveSiteUrl("http://localhost:3000");
  return `${base}/account/reset?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Request a password-reset link.
 *
 * Account enumeration: the response is byte-identical whether the address is
 * registered, unregistered, or belongs to an OAuth-only account. An attacker
 * learns nothing about who has an account here.
 *
 * The one thing we do NOT fake: if no email provider is configured, production
 * returns 503. Returning "check your inbox" for a mail that was never sent is
 * worse than an honest failure — the user would sit locked out, waiting.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  const ipGate = await hit(`reset-ip:${ip}`, POLICY.resetRequestPerIp.limit, POLICY.resetRequestPerIp.windowMs);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    // Shape validation only; still generic about existence.
    return NextResponse.json(GENERIC);
  }

  // Fail loudly on misconfiguration BEFORE minting a token, so we never leave a
  // live token in the database that nobody can receive.
  if (!isEmailConfigured() && process.env.NODE_ENV === "production") {
    log.error({}, "auth:reset-requested-but-email-not-configured");
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Please contact support." },
      { status: 503 },
    );
  }

  // Per-account limit, so rotating IPs doesn't grant unlimited mail to one victim.
  const acctGate = await hit(`reset-acct:${email}`, POLICY.resetRequestPerAccount.limit, POLICY.resetRequestPerAccount.windowMs);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  // Send only for a real, credential-based account that is within its limit.
  // Every branch below still returns GENERIC.
  if (user?.passwordHash && acctGate.ok) {
    try {
      const raw = await issueResetToken(user.id, ip);
      await sendEmail({
        to: email,
        subject: "Reset your Combat Reviews password",
        text:
          `Someone asked to reset the password for your Combat Reviews account.\n\n` +
          `Reset it here (this link works once and expires in ${RESET_TTL_MINUTES} minutes):\n\n` +
          `${resetUrl(raw)}\n\n` +
          `If this wasn't you, you can ignore this email — your password hasn't changed.\n`,
      });
    } catch (e) {
      if (e instanceof EmailNotConfiguredError) {
        return NextResponse.json(
          { error: "Password reset is temporarily unavailable. Please contact support." },
          { status: 503 },
        );
      }
      // A send failure must not reveal that the account exists.
      log.error({ err: (e as Error).message }, "auth:reset-email-failed");
    }
  }

  return NextResponse.json(GENERIC);
}
