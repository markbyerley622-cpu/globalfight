import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { processAndStoreContentImage } from "@/lib/images/store";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per image

/**
 * Forum/content image upload. Any signed-in member can attach photos to a
 * thread or reply. The file is processed server-side into a full + thumbnail
 * WebP pair (aspect preserved) and stored through the image pipeline (Vercel
 * Blob / R2 / local). Returns an `image` attachment descriptor the composer
 * adds to the post's `attachments`.
 */
export async function POST(req: Request) {

  // Public media uploads are disabled at launch: there is no malware scanner and no
  // moderation queue, and we refuse rather than publish an unscanned file.
  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "File must be an image." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 10 MB." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await processAndStoreContentImage("forum", randomUUID(), buffer);
    return NextResponse.json({
      attachment: {
        type: "image",
        url: stored.url,
        thumbUrl: stored.thumbUrl,
        width: stored.width,
        height: stored.height,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not process image." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
