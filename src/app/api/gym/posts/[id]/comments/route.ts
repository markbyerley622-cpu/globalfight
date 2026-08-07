import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listComments, addComment, editComment, deleteComment } from "@/lib/gym-posts/repo";
import { refusalOf } from "@/lib/gym-posts/errors";
import { COMMENT_PAGE_SIZE } from "@/lib/gym-posts/types";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gym/posts/[id]/comments?cursor=&limit=
 *
 * Oldest-first, keyset-paginated. A conversation reads top to bottom.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const user = await getCurrentUser().catch(() => null);

  const page = await listComments({
    postId: id,
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit") ?? COMMENT_PAGE_SIZE),
    user,
  });
  return NextResponse.json(page, { headers: { "cache-control": "private, no-store" } });
}

/** POST — add a comment, or a reply to one (`parentId`). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to comment." }, { status: 401 });

  const gate = await hit(
    `gym-comment:${user.id}`,
    POLICY.gymPostComment.limit,
    POLICY.gymPostComment.windowMs,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const comment = await addComment({
      postId: id,
      authorId: user.id,
      authorRole: user.role,
      body: typeof body.body === "string" ? body.body : "",
      // Unvalidated by design — resolveDraftEntities in the service layer is
      // the one place that checks them (CLAUDE.md rule 2).
      entities: (body as { entities?: unknown }).entities,
      parentId: typeof body.parentId === "string" ? body.parentId : null,
    });
    return NextResponse.json({ ok: true, comment }, { status: 201 });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}

/**
 * PATCH — edit a comment. `commentId` in the BODY rather than a nested route.
 *
 * A comment only ever exists inside a post, and the service re-derives the post
 * from the comment anyway, so a second dynamic segment would add a path without
 * adding a check. Keeping it here also keeps the domain's URL surface exactly
 * as specified.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const commentId = typeof body.commentId === "string" ? body.commentId : "";
  if (!commentId) return NextResponse.json({ error: "Which comment?" }, { status: 400 });

  try {
    const comment = await editComment({
      commentId,
      userId: user.id,
      userRole: user.role,
      body: typeof body.body === "string" ? body.body : "",
    });
    return NextResponse.json({ ok: true, comment });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}

/** DELETE — soft-delete a comment. Author, the gym's owner, or staff. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const commentId = new URL(req.url).searchParams.get("commentId") ?? "";
  if (!commentId) return NextResponse.json({ error: "Which comment?" }, { status: 400 });

  try {
    await deleteComment({ commentId, userId: user.id, userRole: user.role });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}
