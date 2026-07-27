import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail, isEmailConfigured, EmailNotConfiguredError } from "@/lib/email/send";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { SITE } from "@/lib/config";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "I forgot my username." Emails the handle to the address on the account.
 *
 * ── WHY THIS IS AN EMAIL AND NOT A RESPONSE BODY ──────────────────────────
 * Returning the username to whoever asked would turn this endpoint into an
 * email→username oracle: anyone could walk a list of addresses and harvest the
 * handle for each one. The handle then goes in a public URL (/u/<handle>), so that
 * is a direct email→person deanonymisation. The answer only ever goes to the
 * mailbox that can already prove ownership.
 *
 * Same GENERIC response as password reset, for the same reason: a different reply
 * for "registered" and "not registered" is an account-existence oracle, and the
 * two endpoints must not disagree with each other about whether an address exists.
 *
 * Rate limits mirror the reset flow exactly — per IP and per account — so this
 * cannot be used to flood somebody's inbox or to probe addresses in bulk.
 */
const GENERIC = {
  ok: true,
  message: "If that email is registered, we've sent the username to it.",
};

export async function POST(req: Request) {
  const ipGate = await hit(
    `username-remind-ip:${clientIp(req)}`,
    POLICY.resetRequestPerIp.limit,
    POLICY.resetRequestPerIp.windowMs,
  );
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // The one thing we do NOT fake. Returning "check your inbox" for a mail that was
  // never sent is worse than an error: the user waits, nothing arrives, and they
  // conclude they have no account. Same rule as the reset request.
  if (!isEmailConfigured()) {
    log.error({}, "auth:username-reminder-requested-but-email-not-configured");
    return NextResponse.json(
      { error: "Username reminders are temporarily unavailable." },
      { status: 503 },
    );
  }

  const acctGate = await hit(
    `username-remind-acct:${email}`,
    POLICY.resetRequestPerAccount.limit,
    POLICY.resetRequestPerAccount.windowMs,
  );
  if (!acctGate.ok) return NextResponse.json(GENERIC);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { username: true },
  });

  // No account, or an account with no handle yet — nothing to send, and the caller
  // is told exactly what a registered address is told.
  if (!user?.username) return NextResponse.json(GENERIC);

  try {
    await sendEmail({
      to: email,
      subject: `Your ${SITE.name} username`,
      text:
        `Your username on ${SITE.name} is:\n\n` +
        `    ${user.username}\n\n` +
        `Sign in with your email address and password: ${SITE.url}/account\n` +
        `Your public profile: ${SITE.url}/u/${user.username}\n\n` +
        `If you didn't ask for this, you can ignore this email — nothing about your ` +
        `account has changed.\n`,
    });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      return NextResponse.json({ error: "Username reminders are temporarily unavailable." }, { status: 503 });
    }
    // A provider failure must not leak that the address WAS registered, so the
    // caller still gets the generic reply. It is logged for us to see.
    log.error({ err: (e as Error).message }, "auth:username-reminder-email-failed");
  }

  return NextResponse.json(GENERIC);
}
