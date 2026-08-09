import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { voteFeedback, unvoteFeedback } from "@/lib/feedback";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  Voting. Server-authoritative, idempotent, one per member per item.
//
//  The client sends NOTHING but its intent — no user id, no count, no delta.
//  Who is voting comes from the session; how many votes exist is counted from
//  the rows after the write. There is no number in the request that the server
//  trusts, which is what makes "forge the vote count" not a scenario.
//
//  Both verbs are idempotent on purpose. A double-tap, a retried request and a
//  flaky connection all converge on the same state rather than toggling, which
//  is the behaviour an optimistic UI needs underneath it.
// ════════════════════════════════════════════════════════════════════════════

async function gate(userId: string) {
  // Generous — a member working down the board taps this a lot, and a limit
  // that makes normal voting fail is worse than none. This is here to stop a
  // script, not a reader.
  return hit(`feedback-vote:${userId}`, POLICY.forumPost.limit, POLICY.forumPost.windowMs);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });

  const g = await gate(user.id);
  if (!g.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "retry-after": String(g.retryAfter) } },
    );
  }

  const { id } = await params;
  const result = await voteFeedback(user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });

  const g = await gate(user.id);
  if (!g.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "retry-after": String(g.retryAfter) } },
    );
  }

  const { id } = await params;
  // Scoped to the session's own vote by construction: unvoteFeedback deletes
  // where { feedbackId, userId }, and userId is not a parameter the caller
  // supplies. Removing someone else's vote is not expressible.
  return NextResponse.json(await unvoteFeedback(user.id, id));
}
