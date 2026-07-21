import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { castPick, clearPick } from "@/lib/picks";

/** Cast/change the viewer's pick on a bout. Body: { corner: "RED"|"BLUE", confidence?: 1..5, method?: "KO"|"SUB"|"UD" } */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to make a pick." }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await castPick(user.id, slug, body?.corner, body?.confidence, body?.method));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save pick." }, { status: 400 });
  }
}

/** Clear the viewer's pick on a bout. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to make a pick." }, { status: 401 });
  try {
    return NextResponse.json(await clearPick(user.id, slug));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not clear pick." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
