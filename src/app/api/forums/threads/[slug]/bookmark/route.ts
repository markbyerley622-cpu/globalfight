import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleBookmark } from "@/lib/forum/repo";

/** Toggle Save/Bookmark on a thread for the current user. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to save threads." }, { status: 401 });
  try {
    return NextResponse.json(await toggleBookmark(slug, user.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
