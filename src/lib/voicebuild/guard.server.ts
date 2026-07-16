// ════════════════════════════════════════════════════════════════════════
//  Voicebuild access guard.
//
//  Every /api/voicebuild/* route was previously ANONYMOUS: no session check, no
//  rate limit, no quota. Anyone on the internet could POST unlimited audio and it
//  would be forwarded to Deepgram / OpenAI / xAI on the operator's API keys —
//  a cost-DoS, and an unlogged pipe for pushing arbitrary third-party audio into
//  US processors under this operator's account.
//
//  This module is the single gate. Rules:
//    • the feature is OFF unless VOICEBUILD_ENABLED=true (fail closed);
//    • the caller must be authenticated BEFORE the body is read or buffered;
//    • provider status is ADMIN-only;
//    • per-user and per-IP rate limits, plus a per-user daily quota;
//    • errors are uniform and never leak provider identity or configuration.
//
//  Nothing here calls a provider. A rejected request must not cost the operator a
//  single API call — which is why the guard runs before `req.formData()`.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { flags } from "@/lib/feature-flags";
import { prisma } from "@/lib/db";

/** Uniform, information-free rejection. Same shape for every failure mode. */
export function deny(status: number, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

/** The feature is unavailable — indistinguishable from "route does not exist". */
export const notAvailable = () => deny(404, "Not found.");

export type GuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export interface GuardOptions {
  /** Require an ADMIN/MODERATOR. Used for provider-status. */
  adminOnly?: boolean;
  /** Count this request against the caller's daily quota. */
  countsTowardQuota?: boolean;
}

/** Per-user daily cap on AI processing calls. Bounds spend even for a real user. */
export const DAILY_QUOTA = Number(process.env.VOICEBUILD_DAILY_QUOTA ?? "20");

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

/**
 * Gate a voicebuild request.
 *
 * MUST be called before the request body is read. Returning early here is the
 * whole point: an anonymous caller must never reach a provider, and must never
 * even cause us to buffer their audio into memory.
 */
export async function guardVoicebuild(req: Request, options: GuardOptions = {}): Promise<GuardResult> {
  // 1. Feature flag. Off by default; a disabled feature looks like it isn't there.
  if (!flags().voicebuildEnabled) {
    return { ok: false, response: notAvailable() };
  }

  // 2. Authentication — before any body read.
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: deny(401, "Sign in required.") };
  }

  // 3. Authorization.
  if (options.adminOnly && !isAdmin(user.role)) {
    // 404, not 403: a normal user should not learn that an admin surface exists.
    return { ok: false, response: notAvailable() };
  }

  // 4. Rate limits — per user AND per IP. The user limit stops one account
  //    draining the budget; the IP limit stops one host cycling many accounts.
  const perUser = await hit(`voicebuild:${user.id}`, POLICY.voicebuild.limit, POLICY.voicebuild.windowMs);
  if (!perUser.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "retry-after": String(perUser.retryAfter), "cache-control": "private, no-store" } },
      ),
    };
  }
  const perIp = await hit(`voicebuild-ip:${clientIp(req)}`, POLICY.voicebuild.limit * 3, POLICY.voicebuild.windowMs);
  if (!perIp.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "retry-after": String(perIp.retryAfter), "cache-control": "private, no-store" } },
      ),
    };
  }

  // 5. Daily quota — a hard ceiling on third-party spend per user per day.
  if (options.countsTowardQuota) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await prisma.auditLog.count({
      where: { actorId: user.id, action: "voicebuild.process", createdAt: { gte: since } },
    });
    if (used >= DAILY_QUOTA) {
      return {
        ok: false,
        response: deny(429, "Daily voice-processing limit reached. Try again tomorrow."),
      };
    }
  }

  return { ok: true, user };
}

/**
 * Record one processing call against the quota.
 *
 * Metadata only. NEVER the audio, the transcript, the extracted profile, or any
 * provider key — an audit row must not become a second copy of the personal data
 * it is describing.
 */
export async function recordVoicebuildUse(userId: string, meta: { bytes: number; mime: string }): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: "voicebuild.process",
      entity: "User",
      entityId: userId,
      meta: { bytes: meta.bytes, mime: meta.mime },
    },
  }).catch(() => { /* quota accounting must not break the request */ });
}
