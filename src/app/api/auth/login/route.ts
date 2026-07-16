import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { hit, reset, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Bound online guessing per account and per source host. Both are needed: the
  // account limit stops an attacker rotating IPs against one victim; the IP limit
  // stops them spraying one password across many accounts.
  const acct = await hit(`login:${email}`, POLICY.login.limit, POLICY.login.windowMs);
  const host = await hit(`login-ip:${ip}`, POLICY.login.limit * 5, POLICY.login.windowMs);
  if (!acct.ok || !host.ok) {
    const retryAfter = Math.max(acct.retryAfter, host.retryAfter);
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, name: true, email: true, username: true, image: true, bannerUrl: true,
      registryRole: true, role: true, reputation: true, passwordHash: true, tokenVersion: true,
    },
  });

  // Same generic message whether the email is unknown or the password is wrong.
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  // Don't punish a user who simply mistyped once before succeeding.
  await reset(`login:${email}`);

  const { passwordHash: _omit, tokenVersion, ...safe } = user;
  void _omit;
  const token = await signSession(user.id, tokenVersion);
  const res = NextResponse.json({ user: safe });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return res;
}
