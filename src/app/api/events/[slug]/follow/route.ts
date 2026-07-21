import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleFollowEvent } from "@/lib/follows";

/** Toggle Follow on an event — "remind me about this card". */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to follow events." }, { status: 401 });
  try {
    return NextResponse.json(await toggleFollowEvent(user.id, decodeURIComponent(slug)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not follow." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
