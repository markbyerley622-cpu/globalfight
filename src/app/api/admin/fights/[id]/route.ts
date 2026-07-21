import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { saveFight, removeFight, type FightPatch } from "@/lib/admin/fights";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { patch?: FightPatch; expectedUpdatedAt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.patch) return NextResponse.json({ error: "Missing patch." }, { status: 400 });

  const result = await saveFight(user.id, id, body.patch, body.expectedUpdatedAt);
  if (result.conflict) return NextResponse.json(result, { status: 409 });
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const r = await removeFight(user.id, id);
  if (!r.ok) return NextResponse.json({ error: "Fight not found." }, { status: 404 });
  return NextResponse.json(r);
}

export const dynamic = "force-dynamic";
