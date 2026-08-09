import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { setStatus, setHidden } from "@/lib/feedback";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff actions on one feedback item: move its status, or hide it.
 *
 * `requireAdminApi()` FIRST, before the body is read and before anything is
 * looked up — the authorisation decision does not depend on any value the
 * caller supplied. The staff identity written to the audit row comes from that
 * session and is never taken from the request, so "forge the reviewer" is not
 * expressible here either.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminApi();
  if (!admin) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  }

  const gate = await hit(`feedback-admin:${admin.id}`, POLICY.interaction.limit, POLICY.interaction.windowMs);
  if (!gate.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  if (typeof body.hidden === "boolean") {
    const r = await setHidden(admin.id, id, body.hidden);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 404 });
  }

  if (typeof body.status === "string") {
    const r = await setStatus(admin.id, id, body.status, {
      publicNote: typeof body.publicNote === "string" ? body.publicNote : undefined,
      adminNote: typeof body.adminNote === "string" ? body.adminNote : undefined,
    });
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
}
