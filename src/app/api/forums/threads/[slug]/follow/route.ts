import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleSubscription } from "@/lib/forum/repo";

/** Toggle Follow/Subscribe on a thread (adds it to the viewer's feed). */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to follow threads." }, { status: 401 });
  try {
    return NextResponse.json(await toggleSubscription(slug, user.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not follow." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
