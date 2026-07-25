import "server-only";
import { NextResponse } from "next/server";
import { hit, clientIp } from "./index";

/**
 * Enforce a rate limit at the top of a route handler.
 *
 * Returns a ready-to-return 429 `NextResponse` when the caller is over the
 * limit, or `null` to proceed — so a handler reads:
 *
 *   const limited = await enforceLimit(req, "gym-review", POLICY.gymReview, user.id);
 *   if (limited) return limited;
 *
 * `accountId` scopes the bucket to a signed-in user (the right key for
 * authenticated writes — one abusive account can't rotate IPs to escape it).
 * Omit it for anonymous routes and the client IP is used instead (with the
 * XFF-spoofing protection in clientIp). This centralises the 429 shape so every
 * route reports limits identically instead of hand-rolling the response.
 */
export async function enforceLimit(
  req: Request,
  bucket: string,
  policy: { limit: number; windowMs: number },
  accountId?: string | null,
): Promise<NextResponse | null> {
  const id = accountId ?? clientIp(req);
  const gate = await hit(`${bucket}:${id}`, policy.limit, policy.windowMs);
  if (gate.ok) return null;
  return NextResponse.json(
    { error: "You're doing that too fast — take a breather and try again shortly." },
    { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
  );
}
