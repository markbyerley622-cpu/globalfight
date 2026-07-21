import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { createFight, reorderFights, type Segment } from "@/lib/admin/fights";

/** Add a bout to the card. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { redId?: string; blueId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.redId || !body.blueId) return NextResponse.json({ error: "Both corners are required." }, { status: 400 });

  const r = await createFight(user.id, id, { redId: body.redId, blueId: body.blueId });
  if (!r.ok) return NextResponse.json(r, { status: 422 });
  return NextResponse.json(r, { status: 201 });
}

/** Persist a whole reordering. Takes the FULL desired order — moving one bout
 *  changes the index of every bout after it, so a per-move endpoint would leave
 *  the card briefly inconsistent. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { order?: { id: string; segment: Segment }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!Array.isArray(body.order)) return NextResponse.json({ error: "Missing order." }, { status: 400 });

  const r = await reorderFights(user.id, id, body.order);
  if (!r.ok) return NextResponse.json(r, { status: 422 });
  return NextResponse.json(r);
}

export const dynamic = "force-dynamic";
