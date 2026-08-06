import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPost, updatePost, deletePost } from "@/lib/gym-posts/repo";
import { refusalOf } from "@/lib/gym-posts/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gym/posts/[id]
 *
 * 404 covers both "no such post" and "not yours to see". A MEMBERS-only post
 * that answered 403 would confirm its own existence to a stranger holding its
 * id — the existence oracle CLAUDE.md rule 6 closes for DMs and claim evidence,
 * applied here for the same reason.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser().catch(() => null);
  const post = await getPost(id, user);
  if (!post) return NextResponse.json({ error: "No such post." }, { status: 404 });
  return NextResponse.json({ post }, { headers: { "cache-control": "private, no-store" } });
}

/** PATCH /api/gym/posts/[id] — author only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const post = await updatePost({
      id,
      userId: user.id,
      userRole: user.role,
      body: typeof body.body === "string" ? body.body : undefined,
      visibility: typeof body.visibility === "string" ? body.visibility : undefined,
      // `undefined` means "leave media alone"; an empty array means "remove it
      // all". Those are different intents and the distinction has to survive
      // the wire, so the key's ABSENCE is what is tested, not its truthiness.
      media: "media" in body ? body.media : undefined,
    });
    return NextResponse.json({ ok: true, post });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}

/** DELETE /api/gym/posts/[id] — author, the gym's owner, or staff. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  try {
    await deletePost({ id, userId: user.id, userRole: user.role });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { error, status } = refusalOf(e);
    return NextResponse.json({ error }, { status });
  }
}
