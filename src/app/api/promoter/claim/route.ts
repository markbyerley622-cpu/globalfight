import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { searchPromoterOrgs, submitPromoterClaim } from "@/lib/promoter/claims";

/**
 * Apply to host events, and search the organisations you could apply for.
 *
 * ── Access-control walk (CLAUDE.md rules 1–8) ───────────────────────────────
 * 1. Authenticated first — 401 before any work. Anyone signed in may APPLY;
 *    applying grants nothing, so there is no capability gate here. That is the
 *    point of the model: the gate is the decision, not the door.
 * 3. Allow-listed field by field. `status`, `verified`, `ownerId` and
 *    `reviewedById` are never accepted from the body — an applicant posting
 *    `{"status":"approved"}` changes nothing, which is why this builds the
 *    input explicitly instead of spreading `req.json()`.
 * 4. The write is an upsert on (promoterOrgId, userId), so a double-tap or a
 *    re-application cannot race the unique index into a P2002.
 * 5. The service throws human strings; no raw Prisma error reaches the client.
 * 8. Non-GET for the write, JSON only, behind the sameSite=lax cookie.
 *
 * Rate-limited hard: an application creates a PromoterOrg row when none is
 * chosen, and that is the one path here that writes something a human then has
 * to look at.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const orgs = await searchPromoterOrgs(q);
  return NextResponse.json({
    // `claimed` rather than exposing ownerId: whether an organisation is
    // already taken is what the applicant needs; WHO owns it is not theirs.
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, verified: o.verified, claimed: Boolean(o.ownerId) })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to apply." }, { status: 401 });

  const limited = await enforceLimit(req, "promoter-claim", POLICY.conversationOpen, user.id);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

  try {
    const { orgId } = await submitPromoterClaim(user.id, {
      promoterOrgId: typeof body.promoterOrgId === "string" ? body.promoterOrgId : null,
      newOrgName: str(body.newOrgName, 120),
      website: str(body.website),
      socials: str(body.socials),
      contactEmail: str(body.contactEmail, 200),
      phone: str(body.phone, 60),
      previousEvents: str(body.previousEvents, 1000),
      note: str(body.note, 2000),
    });
    return NextResponse.json({ ok: true, orgId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't send that application." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
