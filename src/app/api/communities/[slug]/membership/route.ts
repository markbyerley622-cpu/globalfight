import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { joinCommunity, leaveCommunity } from "@/lib/community/repo";

// POST = join, DELETE = leave. Both require a signed-in user.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { slug } = await params;
  try {
    const result = await joinCommunity(slug, user.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not join." }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { slug } = await params;
  try {
    const result = await leaveCommunity(slug, user.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not leave." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
