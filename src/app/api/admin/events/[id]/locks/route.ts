import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { unlockEventFields, undoEventChange } from "@/lib/admin/events";

/** Release fields back to the importers, or revert one audited change.
 *  Both are audited — "why did this start changing again?" matters as much as
 *  "why did it stop?". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { unlock?: string[]; undo?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  if (body.undo) {
    const r = await undoEventChange(user.id, body.undo);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  if (Array.isArray(body.unlock)) {
    const r = await unlockEventFields(user.id, id, body.unlock);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}

export const dynamic = "force-dynamic";
