import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { reviewVerification, type Decision } from "@/lib/identity-verification";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS: Decision[] = ["APPROVE", "DECLINE", "REQUEST_RESUBMIT"];

/**
 * Record a staff decision on a verification request.
 *
 * Staff-only, checked server-side from the session. The client sends a decision
 * and a reason; it does not send who it is, and it cannot elevate itself by
 * sending a role.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminApi();
  if (!admin) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  }

  const ip = clientIp(req);
  const gate = await hit(`identity-decide:${admin.id}`, POLICY.interaction.limit, POLICY.interaction.windowMs);
  if (!gate.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const decision = body.decision as Decision;
  if (!DECISIONS.includes(decision)) {
    return NextResponse.json({ error: "Unknown decision." }, { status: 400 });
  }

  const result = await reviewVerification(id, admin.id, decision, {
    reason: typeof body.reason === "string" ? body.reason : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
    ip,
  });

  if (!result.ok) {
    const message: Record<string, string> = {
      NOT_FOUND: "That request no longer exists.",
      // Two reviewers with the queue open is the ordinary case, not an edge
      // case, so this needs to read as "someone got there first".
      NOT_OPEN: "That request has already been decided.",
      REASON_REQUIRED: "A reason is required — the user sees it.",
    };
    return NextResponse.json({ error: message[result.reason] }, { status: result.reason === "NOT_FOUND" ? 404 : 409 });
  }

  log.info({ adminId: admin.id, verificationId: id, decision }, "identity:decided");
  return NextResponse.json({ ok: true });
}
