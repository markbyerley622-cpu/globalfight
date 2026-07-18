import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleFollowFighter } from "@/lib/follows";

/** Toggle Follow on a fighter (adds them to the viewer's followed list). */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to follow fighters." }, { status: 401 });
  try {
    return NextResponse.json(await toggleFollowFighter(user.id, slug));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not follow." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
