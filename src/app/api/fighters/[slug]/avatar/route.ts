import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { processAndStoreBuffer } from "@/lib/images/store";
import { setFighterAvatar } from "@/lib/fighters/profile";
import { invalidate } from "@/lib/cache";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Owner-only avatar upload. Accepts multipart/form-data with a single `file`
 * image field, resizes it into the three cached variants, and writes them onto
 * the Fighter row so the photo updates everywhere the avatar is shown.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {

  // Public media uploads are disabled at launch: there is no malware scanner and no
  // moderation queue, and we refuse rather than publish an unscanned file.
  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "File must be an image." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const stored = await processAndStoreBuffer(slug, buffer);
    // Cache-bust: the stored paths are stable, so version them so browsers and
    // the Next image optimizer pick up the new photo immediately.
    const v = `?v=${Date.now()}`;
    const images = {
      thumbUrl: stored.thumbUrl + v,
      imageUrl: stored.imageUrl + v,
      heroImageUrl: stored.heroImageUrl + v,
    };
    await setFighterAvatar(user.id, slug, images);   // throws if the user doesn't own this profile
    await invalidate(`fighter:${slug}`);
    return NextResponse.json({ ok: true, ...images });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not process image.";
    return NextResponse.json({ error: msg }, { status: msg.includes("own") ? 403 : 400 });
  }
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
