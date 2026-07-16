import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  hashPassword, signSession, cookieOptions, SESSION_COOKIE, REGISTRY_ROLES,
} from "@/lib/auth";
import { checkPassword } from "@/lib/password-policy";
import { MINIMUM_AGE, AGE_POLICY_VERSION } from "@/lib/age-policy";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Handle is derived from the chosen NAME (never the email), e.g.
// "Conor McGregor" → "conormcgregor". Falls back to the email local-part only
// if no name was given.
function deriveUsername(seed: string): string {
  return seed.replace(/[^a-z0-9_]+/gi, "").slice(0, 20).toLowerCase() || "member";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const registryRole = REGISTRY_ROLES.includes(body.registryRole as never)
    ? (body.registryRole as string)
    : "fan";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const weak = checkPassword(password);
  if (weak) return NextResponse.json({ error: weak }, { status: 400 });

  // Age declaration. An acknowledgement, NOT a date of birth — we need to know you
  // meet the minimum age, and a full birth date is more personal data than that
  // question requires. This is not proof of age and is not presented as such.
  //
  // A user who tells us they are under age is refused rather than quietly accepted.
  if (body.ageConfirmed !== true) {
    return NextResponse.json(
      { error: `You must confirm you are at least ${MINIMUM_AGE} to create an account.`, code: "AGE_REQUIRED" },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  // Ensure a unique username, derived from the name they chose.
  let username = deriveUsername(name || email.split("@")[0]);
  if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
    username = `${username}${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email, name: name || null, username, passwordHash, registryRole,
      ageConfirmed: true,
      ageConfirmedAt: new Date(),
      agePolicyVersion: AGE_POLICY_VERSION,
    },
    select: {
      id: true, name: true, email: true, username: true, image: true, bannerUrl: true,
      registryRole: true, role: true, reputation: true, tokenVersion: true,
    },
  });

  const { tokenVersion, ...safe } = user;
  const token = await signSession(user.id, tokenVersion);
  const res = NextResponse.json({ user: safe }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return res;
}
