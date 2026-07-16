import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser, getSessionUserId } from "@/lib/auth";
import { listClips, createClip } from "@/lib/clips/repo";
import { storeClipVideo } from "@/lib/clips/storage";
import { streamUrls } from "@/lib/clips/stream";

const MAX_BYTES = 64 * 1024 * 1024; // 64 MB per clip (direct/R2 fallback cap)
const EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit")) || undefined;
  const communitySlug = searchParams.get("community") ?? undefined;
  const viewerId = (await getSessionUserId()) ?? undefined;
  const page = await listClips({ cursor, limit, communitySlug, viewerId });
  return NextResponse.json(page);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to upload a clip." }, { status: 401 });

  // Cloudflare Stream finalize: the file was uploaded straight to Cloudflare, so
  // we just record the clip pointing at its HLS manifest + generated poster.
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
    const streamUid = typeof body.streamUid === "string" ? body.streamUid : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!streamUid) return NextResponse.json({ error: "Missing upload reference." }, { status: 400 });
    if (title.length < 3 || title.length > 160) return NextResponse.json({ error: "Give it a title (3–160 chars)." }, { status: 400 });
    const { videoUrl, posterUrl } = streamUrls(streamUid);
    const clip = await createClip({
      authorId: user.id, title, videoUrl, posterUrl,
      topic: typeof body.topic === "string" ? body.topic : null,
      communitySlug: typeof body.communitySlug === "string" ? body.communitySlug : null,
    });
    return NextResponse.json({ clip }, { status: 201 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const topic = form.get("topic") ? String(form.get("topic")) : null;
  const communitySlug = form.get("communitySlug") ? String(form.get("communitySlug")) : null;

  if (!(file instanceof File)) return NextResponse.json({ error: "No video provided." }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: "Video must be MP4, WebM or MOV." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Clip must be under 64 MB." }, { status: 400 });
  if (title.length < 3 || title.length > 160) return NextResponse.json({ error: "Give it a title (3–160 chars)." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `clips/${randomUUID()}.${ext}`;
    const videoUrl = await storeClipVideo(key, buffer, file.type);
    const clip = await createClip({ authorId: user.id, title, videoUrl, topic, communitySlug });
    return NextResponse.json({ clip }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save clip." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
