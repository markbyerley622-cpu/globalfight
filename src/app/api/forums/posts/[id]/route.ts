import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { editPost, deletePost } from "@/lib/forum/repo";

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (content.length < 1 || content.length > 10000) {
    return NextResponse.json({ error: "Content cannot be empty." }, { status: 400 });
  }

  try {
    const post = await editPost({ postId: id, userId: user.id, isAdmin: isAdmin(user.role), content });
    return NextResponse.json({ post });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not edit post.";
    return NextResponse.json({ error: msg }, { status: msg.includes("only") ? 403 : 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  try {
    await deletePost({ postId: id, userId: user.id, isAdmin: isAdmin(user.role) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not delete post.";
    return NextResponse.json({ error: msg }, { status: msg.includes("only") ? 403 : 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
