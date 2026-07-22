import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleFollowPromotion } from "@/lib/follows";

/** Toggle Follow on a promotion. `slug` is any promotion string; it's
 *  normalised to a registry slug so follows stay stable across event naming. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to follow promotions." }, { status: 401 });
  // Explicit intent when the client sends it; toggle when it does not. A
  // retried or double-tapped request must not undo the first one.
  const body = (await req.json().catch(() => null)) as { follow?: boolean } | null;
  const intent = typeof body?.follow === "boolean" ? body.follow : undefined;
  try {
    return NextResponse.json(await toggleFollowPromotion(user.id, decodeURIComponent(slug), intent));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not follow." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
