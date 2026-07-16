import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBookmarks } from "@/lib/forum/repo";

/** The current user's saved (bookmarked) threads. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ items: [], nextCursor: null });
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit")) || undefined;
  return NextResponse.json(await listBookmarks(user.id, { cursor, limit }));
}

export const dynamic = "force-dynamic";
