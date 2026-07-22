import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { addReaction } from "@/lib/forum/repo";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  Thread reactions — the endpoint ThreadCard's TODO was waiting for.
//
//  Until now the Respect / Salute rail was PURE LOCAL STATE: a user tapped it,
//  watched the number go up, refreshed, and it was gone. A control that
//  animates and persists nothing is worse than no control, because it tells
//  the user their vote counted.
//
//  No schema change. ForumReaction is keyed to a POST, and a thread's opening
//  post is precisely what "reacting to the thread" means on a forum — so this
//  resolves the thread to its first post and reuses addReaction(), the same
//  function the per-post rail already calls. One reaction system, not two.
// ════════════════════════════════════════════════════════════════════════════

const TYPES = new Set(["respect", "disrespect"]);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to react." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { type?: string };
  const type = TYPES.has(body.type ?? "") ? body.type! : "respect";

  const thread = await prisma.forumThread.findUnique({
    where: { slug },
    select: {
      id: true,
      posts: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
    },
  });
  if (!thread) return NextResponse.json({ error: "No such thread." }, { status: 404 });

  const openingPost = thread.posts[0];
  if (!openingPost) {
    // A thread with no posts cannot carry a reaction. Say so rather than
    // silently succeeding — the client shows the vote as un-cast.
    return NextResponse.json({ error: "This thread has nothing to react to yet." }, { status: 409 });
  }

  try {
    const result = await addReaction({ postId: openingPost.id, userId: user.id, type });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not react." },
      { status: 400 },
    );
  }
}
