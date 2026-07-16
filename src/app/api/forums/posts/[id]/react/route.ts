import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addReaction } from "@/lib/forum/repo";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in to react." }, { status: 401 });

  let type = "like";
  try {
    const body = await req.json();
    if (typeof body?.type === "string") type = body.type;
  } catch { /* default to like */ }

  try {
    const result = await addReaction({ postId: id, userId: user.id, type });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not react." }, { status: 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
