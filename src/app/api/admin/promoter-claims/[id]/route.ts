import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { decidePromoterClaim, type ClaimDecision } from "@/lib/promoter/claims";

const DECISIONS = new Set<ClaimDecision>(["approved", "rejected", "info_requested"]);

/**
 * Decide a promoter application.
 *
 * ── Access-control walk (CLAUDE.md rules 1–8) ───────────────────────────────
 * 1. Authenticated first — 401 before any work.
 * 2/`isAdminRole` is THE one definition (lib/admin/guard); this gates on `role`,
 *    never on `registryRole`. A 403 for a signed-in non-admin, matching the
 *    rest of /api/admin/*.
 * 3. Allow-listed: the decision is checked against a fixed set, so a body of
 *    `{"decision":"verified"}` is refused rather than written through.
 * 4. The service wraps the claim update, the org flags and the audit row in one
 *    transaction — a half-applied approval must not leave an org verified with
 *    no owner (which `promoterState` would refuse anyway, failing closed).
 * 5. Human strings only; no raw Prisma error reaches the client.
 * 8. JSON POST behind the sameSite=lax cookie.
 *
 * Every decision writes an AuditLog row naming the actor. A publishing right
 * granted with no record of who granted it, when, or why becomes unanswerable
 * the first time a bogus event is published.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { decision?: string; reason?: string };

  if (!DECISIONS.has(body.decision as ClaimDecision)) {
    return NextResponse.json({ error: "Unknown decision." }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 1000).trim() : "";

  // A refusal the applicant will read has to say something. An empty rejection
  // is the reason people re-apply with the identical application.
  if (body.decision !== "approved" && !reason) {
    return NextResponse.json({ error: "Give a reason — the applicant sees it." }, { status: 400 });
  }

  try {
    await decidePromoterClaim(user.id, id, body.decision as ClaimDecision, reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't record that decision." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
