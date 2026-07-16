import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getSessionUserId, verifyPassword, hashPassword, signSession,
  cookieOptions, SESSION_COOKIE,
} from "@/lib/auth";
import { checkPassword } from "@/lib/password-policy";
import { hit, reset, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change the signed-in user's password.
 *
 * CSRF: the session cookie is SameSite=Lax, so a cross-site POST from an
 * attacker's page carries no cookie and lands here unauthenticated (401). We
 * additionally require a JSON content-type, which a cross-origin HTML form
 * cannot set without triggering a preflight the browser will block.
 *
 * On success every existing session is revoked (tokenVersion bump) and this
 * device — and only this device — is re-issued a fresh cookie.
 */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Sign in to change your password." }, { status: 401 });

  // A simple-request form post cannot set application/json cross-origin.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  }

  const gate = await hit(`pwchange:${uid}`, POLICY.passwordChange.limit, POLICY.passwordChange.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }
  // Also bound by IP, so one attacker can't cycle accounts from one host.
  const ipGate = await hit(`pwchange-ip:${clientIp(req)}`, POLICY.passwordChange.limit * 4, POLICY.passwordChange.windowMs);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(ipGate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";

  const problem = checkPassword(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const u = await prisma.user.findUnique({ where: { id: uid }, select: { passwordHash: true } });
  if (!u) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  // OAuth-only account: there is no local password to verify. We do NOT silently
  // let the caller set one — that would turn a stolen OAuth session into a
  // permanent credential. Direct them to the (separate) set-password flow.
  if (!u.passwordHash) {
    return NextResponse.json(
      { error: "This account signs in with a linked provider and has no password to change.", code: "OAUTH_ONLY" },
      { status: 409 },
    );
  }

  if (!current) return NextResponse.json({ error: "Enter your current password." }, { status: 400 });

  if (!(await verifyPassword(current, u.passwordHash))) {
    // Generic: never disclose whether the account exists, is locked, or how many
    // attempts remain.
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  // Block a no-op "change" that would give a false sense of rotation.
  if (await verifyPassword(next, u.passwordHash)) {
    return NextResponse.json({ error: "Your new password must be different from your current one." }, { status: 400 });
  }

  const passwordHash = await hashPassword(next);

  // Rehash + revoke every session atomically: a crash between the two must not
  // leave the password changed while old cookies still work.
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: uid },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    await tx.auditLog.create({
      data: { actorId: uid, action: "auth.password.change", entity: "User", entityId: uid },
    });
    return user;
  });

  await reset(`pwchange:${uid}`);

  // Every other device is now signed out. Keep this one signed in by minting a
  // token at the new epoch.
  const res = NextResponse.json({ ok: true, signedOutOtherSessions: true });
  res.cookies.set(SESSION_COOKIE, await signSession(uid, updated.tokenVersion), cookieOptions);
  return res;
}
