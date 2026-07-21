import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/guard";
import { createDraftEvent } from "@/lib/admin/events";

/** Create a blank DRAFT. An operator always edits a REAL row, which is what
 *  lets autosave, field locking and the audit trail work from the first
 *  keystroke instead of only after some "create" step. */
export async function POST(req: Request) {
  const user = await requireAdminApi();
  if (!user) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: { name?: string; sport?: string; date?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 3) return NextResponse.json({ error: "Title needs at least 3 characters." }, { status: 422 });
  const date = typeof body.date === "string" && !Number.isNaN(Date.parse(body.date)) ? body.date : new Date().toISOString();

  const ev = await createDraftEvent(user.id, { name, sport: body.sport ?? "MMA", date });
  return NextResponse.json(ev, { status: 201 });
}

export const dynamic = "force-dynamic";
