import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { processAndStoreContentImage } from "@/lib/images/store";
import { readImageUpload, isDecodeError } from "@/lib/images/upload-policy";
import { log } from "@/lib/scraper/logger";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Shared policy, not a second copy. This route hand-rolled its own limits and
  // allow-list, which had drifted: it accepted a ZERO-BYTE file and had no
  // magic-byte check, so a corrupt upload reached sharp and 500'd. Both
  // measured against a live production build.
  const read = await readImageUpload(form);
  if (!read.ok) return read.response;

  try {
    const buffer = read.value.buffer;
    // Unique id per upload busts any CDN/browser cache of the previous image.
    const { url } = await processAndStoreContentImage("profiles", `${userId}/${kind}-${randomUUID()}`, buffer);
    await prisma.user.update({
      where: { id: userId },
      data: kind === "banner" ? { bannerUrl: url } : { image: url },
    });
    return NextResponse.json({ ok: true, url, kind });
  } catch (e) {
    // A corrupt or truncated image is the CALLER's problem, not a server fault.
    if (isDecodeError(e)) {
      return NextResponse.json({ error: "That image is corrupt or unreadable." }, { status: 415 });
    }
    log.warn({ userId, kind, err: (e as Error).message }, "profile:image-upload-failed");
    return NextResponse.json({ error: "Could not save the image. Please try again." }, { status: 500 });
  }
}
