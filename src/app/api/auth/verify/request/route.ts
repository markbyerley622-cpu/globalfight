import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { issueVerificationCode, verificationEmail, RESEND_COOLDOWN_SECONDS } from "@/lib/auth-email-verify";
import { sendEmail, isEmailConfigured, EmailNotConfiguredError } from "@/lib/email/send";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send (or re-send) the email-verification code for the signed-in user.
 *
 * Session-gated, which is what makes a 6-digit code safe here: there is no way
 * to aim this at an address you do not already control an account for, so it
 * carries none of the enumeration surface that the password-reset endpoint has
 * to work around.
 *
 * Unlike password reset, this endpoint is honest about the cooldown. Reset has
 * to return a generic body to avoid leaking whether an address exists; here the
 * caller IS the account, so telling them "wait 43 seconds" leaks nothing and is
 * the difference between a resend button that explains itself and one that
 * appears broken.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const ip = clientIp(req);
  const gate = await hit(
    `verify-req:${user.id}`,
    POLICY.verifyRequestPerAccount.limit,
    POLICY.verifyRequestPerAccount.windowMs,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many codes requested. Try again later." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  // Fail before minting, so a misconfigured provider never leaves a live code in
  // the database that nobody can receive — the same rule the reset route follows.
  if (!isEmailConfigured() && process.env.NODE_ENV === "production") {
    log.error({}, "auth:verify-requested-but-email-not-configured");
    return NextResponse.json(
      { error: "Verification email is temporarily unavailable. Please contact support." },
      { status: 503 },
    );
  }

  const issued = await issueVerificationCode(user.id, ip);

  if (!issued.ok) {
    if (issued.reason === "ALREADY_VERIFIED") return NextResponse.json({ ok: true, alreadyVerified: true });
    if (issued.reason === "NO_EMAIL") {
      return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Please wait ${issued.retryAfter}s before requesting another code.`, retryAfter: issued.retryAfter },
      { status: 429, headers: { "retry-after": String(issued.retryAfter ?? RESEND_COOLDOWN_SECONDS) } },
    );
  }

  try {
    const { subject, text } = verificationEmail(issued.code);
    await sendEmail({ to: issued.email, subject, text });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      // Development convenience only. NODE_ENV=production returned 503 above, so
      // this branch cannot leak a code into a real deployment's logs.
      log.warn({ code: issued.code }, "auth:verify-code-not-mailed-email-unconfigured");
      return NextResponse.json({ ok: true, devCode: issued.code });
    }
    log.error({ err: String(err) }, "auth:verify-send-failed");
    return NextResponse.json({ error: "Could not send the code. Try again shortly." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, cooldown: RESEND_COOLDOWN_SECONDS });
}
