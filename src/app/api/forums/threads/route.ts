import { NextResponse } from "next/server";
import { getCurrentUser, getSessionUserId } from "@/lib/auth";
import { getThreads, createThread } from "@/lib/forum/repo";
import { sanitizeAttachments } from "@/lib/forum/embeds";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit")) || undefined;
  const viewerId = (await getSessionUserId()) ?? undefined;
  const page = await getThreads({ categorySlug: category, cursor, limit, viewerId });
  return NextResponse.json(page);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const categorySlug = typeof body.categorySlug === "string" ? body.categorySlug : "";
  const kind = typeof body.kind === "string" ? body.kind : undefined;
  const attachments = sanitizeAttachments(body.attachments);

  if (title.length < 4 || title.length > 160) {
    return NextResponse.json({ error: "Title must be 4–160 characters." }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "Post content is too long (max 10,000 chars)." }, { status: 400 });
  }
  if (content.length < 1 && attachments.length === 0) {
    return NextResponse.json({ error: "Add a message or attach media." }, { status: 400 });
  }
  if (!categorySlug) {
    return NextResponse.json({ error: "Choose a category." }, { status: 400 });
  }

  try {
    const thread = await createThread({ authorId: user.id, categorySlug, title, content, attachments, kind });
    return NextResponse.json({ thread }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not create thread." }, { status: 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
