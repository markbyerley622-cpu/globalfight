import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getVideoDiscussion, createVideoDiscussion } from "@/lib/community/repo";

// GET → the existing primary discussion for this video (or { discussion: null }).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const discussion = await getVideoDiscussion(id);
  return NextResponse.json({ discussion });
}

// POST → start the discussion in the chosen community (idempotent: returns the
// existing one if it was created in the meantime). Requires a signed-in user.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const communitySlug = typeof body.communitySlug === "string" ? body.communitySlug : "";
  if (!communitySlug) return NextResponse.json({ error: "Choose a community." }, { status: 400 });
  const comment = typeof body.comment === "string" ? body.comment.slice(0, 10000) : undefined;

  const video = (body.video ?? {}) as Record<string, unknown>;
  const title = typeof video.title === "string" ? video.title : "";
  if (!title) return NextResponse.json({ error: "Missing video details." }, { status: 400 });

  try {
    const discussion = await createVideoDiscussion({
      userId: user.id,
      communitySlug,
      comment,
      video: {
        id,
        title,
        channel: typeof video.channel === "string" ? video.channel : null,
        channelId: typeof video.channelId === "string" ? video.channelId : null,
        topic: typeof video.topic === "string" ? video.topic : null,
        description: typeof video.description === "string" ? video.description : null,
        tags: Array.isArray(video.tags) ? video.tags.filter((t): t is string => typeof t === "string") : [],
      },
    });
    return NextResponse.json({ discussion }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not start discussion." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
