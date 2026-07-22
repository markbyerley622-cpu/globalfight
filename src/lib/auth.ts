// ════════════════════════════════════════════════════════════════════════
//  Authentication — stateless JWT sessions (httpOnly cookie).
//
//  Why stateless: a signed JWT in an httpOnly cookie needs no session store,
//  so every server/instance validates the same cookie independently. That is
//  exactly the "all devices/computers see the same source of truth" model —
//  users live in one Postgres, sessions are self-contained.
//
//  Revocation: a stateless token cannot be "deleted", so every token carries the
//  user's `tokenVersion` ("session epoch"). Bumping User.tokenVersion — on
//  password change, password reset, or an explicit sign-out-everywhere —
//  instantly invalidates every cookie ever issued to that user. The check costs
//  one indexed primary-key lookup, deduped per request via React `cache()`.
//
//  Node runtime only (bcrypt). Route handlers importing this must NOT set
//  `export const runtime = "edge"`.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { REGISTRY_ROLE_VALUES } from "@/lib/roles";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { resolveAuthSecret } from "@/lib/auth-secret";

export const SESSION_COOKIE = "cr_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Fails closed in production: throws at startup if AUTH_SECRET is missing,
// placeholder, or weak. There is no production fallback by design.
const secret = new TextEncoder().encode(resolveAuthSecret());

// Derived, never re-declared — see src/lib/roles.ts for why this list existed
// in three places with three different contents.
export const REGISTRY_ROLES = REGISTRY_ROLE_VALUES;
export type RegistryRole = string;

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  image: string | null;
  bannerUrl: string | null;
  registryRole: string;
  role: string;
  reputation: number;
}

// ── Password hashing ──────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── JWT session token ─────────────────────────────────────────────────────

/**
 * Sign a session for `userId` at session-epoch `tokenVersion`. Callers must pass
 * the user's *current* tokenVersion — a token minted with a stale epoch is
 * rejected on the next request.
 */
export async function signSession(userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ sub: userId, tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret);
}

interface SessionClaims {
  userId: string;
  tokenVersion: number;
}

async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== "string") return null;
    // Tokens issued before session-epochs existed have no `tv`. Treat them as
    // epoch 0 so they validate against a fresh user (tokenVersion defaults to 0)
    // and are revoked by the first bump, like any other token.
    const tv = typeof payload.tv === "number" ? payload.tv : 0;
    return { userId: payload.sub, tokenVersion: tv };
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};

/** Cookie options that expire the session cookie immediately. */
export const clearedCookieOptions = { ...cookieOptions, maxAge: 0 };

// ── Reading the current user (server components + route handlers) ──────────

const SAFE_SELECT = {
  id: true, name: true, email: true, username: true, image: true, bannerUrl: true,
  registryRole: true, role: true, reputation: true,
} as const;

/**
 * Resolve the cookie to a user, enforcing the session epoch. Deduped per request
 * so the extra lookup costs at most one query per render, no matter how many
 * components ask for the user.
 *
 * Returns null when: no cookie, bad signature, expired, user deleted, or the
 * token's epoch is behind the user's current tokenVersion (i.e. revoked).
 */
const loadSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { ...SAFE_SELECT, tokenVersion: true },
  });
  if (!user) return null;
  if (user.tokenVersion !== claims.tokenVersion) return null; // revoked

  const { tokenVersion: _epoch, ...safe } = user;
  void _epoch;
  return safe as SessionUser;
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  return loadSession();
}

export async function getSessionUserId(): Promise<string | null> {
  return (await loadSession())?.id ?? null;
}

// ── Session revocation ────────────────────────────────────────────────────

/**
 * Invalidate every existing session for a user by bumping the session epoch.
 * Returns the new tokenVersion so the caller can immediately mint a fresh
 * session (e.g. keep the user signed in on the device that changed the
 * password, while signing them out everywhere else).
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  return user.tokenVersion;
}
