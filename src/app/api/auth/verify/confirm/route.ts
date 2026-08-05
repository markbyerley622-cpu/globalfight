import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { redeemVerificationCode, MAX_ATTEMPTS } from "@/lib/auth-email-verify";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redeem the emailed code for the signed-in user.
 *
 * The error messages here are deliberately specific — "that code has expired"
 * versus "wrong code, 3 tries left". Password reset cannot do this, because
 * distinguishing failure modes there tells an attacker their guess was
 * structurally right about someone else's account. Here the caller already
 * holds the session for the account being verified, so the only person the
 * detail helps is the user typing the code.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  }

  const gate = await hit(`verify-confirm:${clientIp(req)}`, POLICY.verifyConfirm.limit, POLICY.verifyConfirm.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const result = await redeemVerificationCode(user.id, code);

  if (result.ok) return NextResponse.json({ ok: true });

  const message: Record<string, string> = {
    INVALID: result.attemptsLeft !== undefined
      ? `That code isn't right. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`
      : "Enter the 6-digit code from your email.",
    EXPIRED: "That code has expired. Send a new one.",
    USED: "That code has already been used. Send a new one.",
    NO_CODE: "No code has been sent yet. Send one to get started.",
    TOO_MANY_ATTEMPTS: `Too many wrong attempts on that code. Send a new one to try again.`,
    EMAIL_CHANGED: "Your email address changed after that code was sent. Send a new one.",
  };

  return NextResponse.json(
    {
      error: message[result.reason] ?? "Could not verify that code.",
      reason: result.reason,
      attemptsLeft: result.attemptsLeft,
      // A burned token is recoverable only by resending, so tell the client to
      // put the resend button forward rather than leaving them retyping.
      needsResend: result.reason === "EXPIRED" || result.reason === "USED"
        || result.reason === "TOO_MANY_ATTEMPTS" || result.reason === "NO_CODE"
        || result.reason === "EMAIL_CHANGED",
      maxAttempts: MAX_ATTEMPTS,
    },
    { status: 400 },
  );
}
