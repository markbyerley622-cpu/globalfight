import { NextResponse } from "next/server";
import { redeemResetToken } from "@/lib/auth-password-reset";
import { checkPassword } from "@/lib/password-policy";
import { SESSION_COOKIE, clearedCookieOptions } from "@/lib/auth";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redeem a reset token and set a new password.
 *
 * Deliberately does NOT sign the user in. After a reset the correct behaviour is
 * to send them to the login screen: if the reset was triggered by an attacker who
 * somehow obtained the link, auto-signing-in the requester hands them the account.
 * Making them log in proves they know the password they just set.
 *
 * Every failure — malformed, unknown, expired, already-used — returns the same
 * message. Telling the caller "that token expired" confirms the token was real.
 */
export async function POST(req: Request) {
  const gate = await hit(`reset-confirm:${clientIp(req)}`, POLICY.resetConfirm.limit, POLICY.resetConfirm.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";

  const problem = checkPassword(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const result = await redeemResetToken(token, password);

  if (!result.ok) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  // The reset revoked every session for this user (including any the attacker
  // held). Clear this browser's cookie too, so the UI can't act on a stale one.
  const res = NextResponse.json({ ok: true, message: "Password updated. Please sign in." });
  res.cookies.set(SESSION_COOKIE, "", clearedCookieOptions);
  return res;
}
