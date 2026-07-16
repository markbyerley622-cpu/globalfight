import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateClip } from "@/lib/clips/repo";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to rate." }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 1 || value > 5) return NextResponse.json({ error: "Rating must be 1–5." }, { status: 400 });

  try {
    const result = await rateClip({ clipId: id, userId: user.id, value });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not rate." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
