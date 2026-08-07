import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { setTyping } from "@/lib/messages/repo";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/**
 * "I am composing." Fire-and-forget presence for one conversation.
 *
 * ── Access-control walk (CLAUDE.md rules 1–8) ───────────────────────────────
 * 1. Authenticated first — anonymous gets 401 before any work.
 * 2. Ownership is NOT checked here. `setTyping` is an `updateMany` scoped by
 *    membership, so the check and the write are one statement in the service
 *    layer and hold for every caller of that function.
 * 4. Concurrency-safe by construction: `updateMany` on one column, no
 *    check-then-write, so two devices belonging to the same person racing each
 *    other cannot produce a constraint error.
 * 6. ALWAYS 204, whatever happened. A non-member's ping is a silent no-op and
 *    is indistinguishable from a member's — this endpoint must not become the
 *    oracle that tells anyone which conversation ids exist, which is the whole
 *    thing the 404-on-everything rule protects for DMs.
 * 8. Non-GET and JSON-only, so a cross-site form post cannot reach it.
 *
 * Rate-limited under `interaction` rather than `directMessage`: it is a
 * high-frequency signal, not a message, and it must not consume the ceiling
 * that governs actually sending one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const limited = await enforceLimit(req, "dm-typing", POLICY.interaction, user.id);
  if (limited) return limited;

  const { id } = await params;
  // Never surfaced. A failed write here costs a moment of a typing dot; it is
  // not worth an error path on the client, and reporting it would leak.
  await setTyping(id, user.id).catch(() => {});

  return new NextResponse(null, { status: 204 });
}

export const dynamic = "force-dynamic";
