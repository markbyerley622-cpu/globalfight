import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { heartbeat } from "@/lib/presence/repo";

/**
 * "I'm here."
 *
 * ── Why 204 for everyone, signed in or not ────────────────────────────────
 * The same rule the DM typing endpoint follows (CLAUDE.md rule 6): the answer
 * carries no information. A 401 for anonymous would be harmless here, but the
 * endpoint is called on a timer by every open tab and a body nobody reads is
 * waste — so it always answers 204 and the write underneath simply does not
 * happen without an identity.
 *
 * POST, not GET: it is a state change, it must not be prefetched by a browser
 * or cached by anything, and per rule 8 keeping mutations non-GET is what makes
 * the sameSite=lax cookie a CSRF defence.
 */
export async function POST() {
  const user = await getCurrentUser().catch(() => null);
  if (user) await heartbeat(user.id);
  return new NextResponse(null, { status: 204 });
}

export const dynamic = "force-dynamic";
