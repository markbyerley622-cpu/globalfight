import { NextResponse } from "next/server";
import { getCurrentUser, getSessionUserId } from "@/lib/auth";
import { getPosts, createPost } from "@/lib/forum/repo";
import { sanitizeAttachments } from "@/lib/forum/embeds";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit")) || undefined;
  const viewerId = (await getSessionUserId()) ?? undefined;
  const page = await getPosts(slug, { cursor, limit, viewerId });
  return NextResponse.json(page);
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in to reply." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  const quotePostId = typeof body.quotePostId === "string" ? body.quotePostId : null;
  const attachments = sanitizeAttachments(body.attachments);
  if (content.length > 10000) {
    return NextResponse.json({ error: "Reply is too long (max 10,000 chars)." }, { status: 400 });
  }
  if (content.length < 1 && attachments.length === 0) {
    return NextResponse.json({ error: "Add a message or attach media." }, { status: 400 });
  }

  try {
    const post = await createPost({ authorId: user.id, threadSlug: slug, content, parentId, attachments, quotePostId });
    return NextResponse.json({ post }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not post reply." }, { status: 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
