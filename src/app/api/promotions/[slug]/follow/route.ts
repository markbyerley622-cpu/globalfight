import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleFollowPromotion } from "@/lib/follows";

/** Toggle Follow on a promotion. `slug` is any promotion string; it's
 *  normalised to a registry slug so follows stay stable across event naming. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to follow promotions." }, { status: 401 });
  try {
    return NextResponse.json(await toggleFollowPromotion(user.id, decodeURIComponent(slug)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not follow." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
