import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasStream, createStreamDirectUpload } from "@/lib/clips/stream";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";

// Returns where the client should send the video file:
//   • { mode: "stream", uploadURL, uid } — POST the file to Cloudflare directly.
//   • { mode: "direct" }                 — POST multipart to /api/clips (R2 fallback).
export async function POST() {

  // Public media uploads are disabled at launch: there is no malware scanner and no
  // moderation queue, and we refuse rather than publish an unscanned file.
  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to upload a clip." }, { status: 401 });

  if (hasStream()) {
    try {
      const { uploadURL, uid } = await createStreamDirectUpload();
      return NextResponse.json({ mode: "stream", uploadURL, uid });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Upload init failed." }, { status: 502 });
    }
  }
  return NextResponse.json({ mode: "direct" });
}

export const dynamic = "force-dynamic";
