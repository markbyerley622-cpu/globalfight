import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { processAndStoreContentImage } from "@/lib/images/store";
import { log } from "@/lib/scraper/logger";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

// POST /api/profile/image  (multipart: file, kind=avatar|banner)
// Processes the image to WebP and stores it on the best configured backend
// (Vercel Blob → Cloudflare R2 → local disk), then writes the URL onto the user.
export async function POST(req: Request) {

  // Public media uploads are disabled at launch: there is no malware scanner and no
  // moderation queue, and we refuse rather than publish an unscanned file.
  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const kind = form.get("kind") === "banner" ? "banner" : "avatar";
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Use a JPG, PNG or WebP image." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Unique id per upload busts any CDN/browser cache of the previous image.
    const { url } = await processAndStoreContentImage("profiles", `${userId}/${kind}-${randomUUID()}`, buffer);
    await prisma.user.update({
      where: { id: userId },
      data: kind === "banner" ? { bannerUrl: url } : { image: url },
    });
    return NextResponse.json({ ok: true, url, kind });
  } catch (e) {
    log.warn({ userId, kind, err: (e as Error).message }, "profile:image-upload-failed");
    return NextResponse.json({ error: "Could not save the image. Please try again." }, { status: 500 });
  }
}
