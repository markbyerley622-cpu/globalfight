import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { getEventConflicts, resolveConflict, resolveAll } from "@/lib/admin/reconcile";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return NextResponse.json({ conflicts: await getEventConflicts(id) });
}

/** Accept the import, keep the manual edit, or apply one choice to all. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { conflictId?: string; action?: "accept" | "keep"; all?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (body.action !== "accept" && body.action !== "keep") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  if (body.all) return NextResponse.json(await resolveAll(user.id, id, body.action));
  if (!body.conflictId) return NextResponse.json({ error: "Missing conflict." }, { status: 400 });

  const r = await resolveConflict(user.id, body.conflictId, body.action);
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}

export const dynamic = "force-dynamic";
