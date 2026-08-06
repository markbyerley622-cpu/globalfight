import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sharePost } from "@/lib/gym-posts/repo";
import { refusalOf } from "@/lib/gym-posts/errors";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gym/posts/[id]/share — record a share.
 *
 * ANONYMOUS is allowed: sharing a public post should not require an account,
 * and requiring one would mean the count only ever measures logged-in sharers.
 *
 * Which is exactly why this is the most carefully bounded write in the domain.
 * shareCount is the heaviest single input to the feed ranker, so an unbounded
 * anonymous increment is a one-line script for putting any post at the top of
 * the feed. Bounded per IP AND per post, so somebody sharing one post to a few
 * places is unaffected and a loop against one target is not — the same shape
 * ForumThread's share limit already uses.
 *
 * Only PUBLIC posts are shareable; that refusal lives in the service layer,
 * where it also stops the count advertising that a private post exists.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser().catch(() => null);

  const gate = await hit(
    `gym-share:${clientIp(req)}:${id}`,
    POLICY.gymPostShare.limit,
    POLICY.gymPostShare.windowMs,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { error: "That's enough sharing for now." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  try {
    const result = await sharePost({ postId: id, user });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}
