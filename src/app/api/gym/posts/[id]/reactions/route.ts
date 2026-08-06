import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { reactToPost, reactToComment } from "@/lib/gym-posts/repo";
import { refusalOf } from "@/lib/gym-posts/errors";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gym/posts/[id]/reactions — toggle a reaction.
 *
 * One endpoint for posts and comments: pass `commentId` to react to a comment
 * instead of the post. The write is the same act, the toggle semantics are the
 * same, and splitting it would be two routes drifting apart over one behaviour.
 *
 * Bounded by the shared `interaction` ceiling — the same one picks, votes,
 * follows and helpful votes use — because it is the same kind of write: cheap,
 * frequent, and worth stopping only when it stops being human.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to react." }, { status: 401 });

  const gate = await hit(
    `interaction:${user.id}`,
    POLICY.interaction.limit,
    POLICY.interaction.windowMs,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many actions. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // An unknown type falls back to "like" in the service rather than erroring —
  // a newer client sending a reaction this deploy has not heard of should
  // register something, not fail.
  const type = typeof body.type === "string" ? body.type : "like";
  const commentId = typeof body.commentId === "string" ? body.commentId : null;

  try {
    const result = commentId
      ? await reactToComment({ commentId, userId: user.id, userRole: user.role, type })
      : await reactToPost({ postId: id, userId: user.id, userRole: user.role, type });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}
