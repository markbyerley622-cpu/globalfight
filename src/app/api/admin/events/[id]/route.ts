import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { saveEvent, getEventHistory, type EventPatch } from "@/lib/admin/events";

/** Autosave target. Thin by design — validation, locking and the audit trail all
 *  live in lib/admin/events so there is exactly one write path. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { patch?: EventPatch; expectedUpdatedAt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "Missing patch." }, { status: 400 });
  }

  const result = await saveEvent(user.id, id, body.patch, body.expectedUpdatedAt);
  if (result.conflict) return NextResponse.json(result, { status: 409 });
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}

/** Audit history for the drawer. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return NextResponse.json({ history: await getEventHistory(id) });
}

export const dynamic = "force-dynamic";
