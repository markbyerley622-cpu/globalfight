import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  hashPassword, signSession, cookieOptions, SESSION_COOKIE, REGISTRY_ROLES,
} from "@/lib/auth";
import { checkPassword } from "@/lib/password-policy";
import { isPublishableName } from "@/lib/display-name";
import { MINIMUM_AGE, AGE_POLICY_VERSION } from "@/lib/age-policy";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Display name bounds. Long enough to be a name, short enough not to break a
 * share card headline or a leaderboard row.
 */
const NAME_MIN = 2;
const NAME_MAX = 40;

/**
 * Handle derived from the chosen display NAME — and ONLY from it.
 *
 * The email fallback that used to live here (`name || email.split("@")[0]`) is
 * gone. It was reachable whenever someone left the name blank, and it is how one
 * live account ended up at /u/markbyerley6221gmail: the handle, the display name
 * and therefore the share card, the page title and the meta description were all
 * built out of an email address. A display name is required now, so there is
 * nothing to fall back TO — and no path back to an email-derived identity.
 */
function deriveUsername(seed: string): string {
  return seed.replace(/[^a-z0-9_]+/gi, "").slice(0, 20).toLowerCase() || "member";
}

/**
 * A free handle for this seed.
 *
 * Loops rather than trying a single random suffix: the old code appended one
 * 4-digit number and, if THAT collided, fell through to a create() that threw a
 * raw unique-constraint error at the user. Rare, but a hard failure on the signup
 * path is the worst place to leave a one-in-nine-thousand bug.
 */
async function freeUsername(seed: string): Promise<string> {
  const base = deriveUsername(seed);
  const taken = async (u: string) =>
    !!(await prisma.user.findUnique({ where: { username: u }, select: { id: true } }));
  if (!(await taken(base))) return base;
  for (let i = 0; i < 12; i++) {
    const candidate = `${base.slice(0, 15)}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await taken(candidate))) return candidate;
  }
  // Deterministic last resort — cannot collide within a process-lifetime.
  return `${base.slice(0, 10)}${Date.now().toString(36)}`;
}

export async function POST(req: Request) {
  // Bound per source host BEFORE any bcrypt/DB work: this is both the
  // CPU-exhaustion guard (each success runs bcrypt at 12 rounds) and the
  // rate limiter that makes the "email already exists" 409 useless as a
  // high-speed enumeration oracle.
  const ip = clientIp(req);
  const gate = await hit(`signup-ip:${ip}`, POLICY.signup.limit, POLICY.signup.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

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

  // ── DISPLAY NAME IS REQUIRED ──────────────────────────────────────────────
  // It was optional, and the consequences were not cosmetic: a blank name meant
  // the handle was derived from the email, and a name that WAS an email got
  // published verbatim on the share card, in the page title and in the meta
  // description. Asking for it once, here, is what makes every public surface
  // downstream safe by construction.
  if (name.length < NAME_MIN) {
    return NextResponse.json(
      { error: "Choose a display name — this is what other people will see.", field: "name" },
      { status: 400 },
    );
  }
  if (name.length > NAME_MAX) {
    return NextResponse.json(
      { error: `Display names are up to ${NAME_MAX} characters.`, field: "name" },
      { status: 400 },
    );
  }
  // Refused at the door rather than sanitised later: if we quietly replaced it
  // with their handle they would never know their chosen name was discarded, and
  // if we stored it we would be back to publishing an inbox.
  if (!isPublishableName(name)) {
    return NextResponse.json(
      {
        error: "That looks like an email address. Pick a display name other people will see instead.",
        field: "name",
      },
      { status: 400 },
    );
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

  // Unique handle, derived from the display name they just gave us.
  const username = await freeUsername(name);

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email, name, username, passwordHash, registryRole,
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
