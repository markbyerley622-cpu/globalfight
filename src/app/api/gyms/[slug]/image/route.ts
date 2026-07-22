import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { processAndStoreContentImage, deleteStored } from "@/lib/images/store";
import { readImageUpload } from "@/lib/images/upload-policy";
import { authoriseGymEdit } from "@/lib/geo/gym-auth";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  Gym logo + hero.
//
//  Reuses the app's ONE image pipeline (processAndStoreContentImage → WebP
//  full+thumb → Vercel Blob / R2 / local disk). No second uploader, no second
//  storage abstraction, no direct-to-bucket presign: the bytes go through the
//  same processing every other image in the product does.
//
//  It is also behind the SAME UGC guard as avatars. That guard exists because
//  there is no malware scanner and no moderation queue, and it fails closed.
//  A gym owner is a verified human but not a trusted binary source, so this
//  route does not get an exemption — see src/lib/ugc-guard.ts.
// ════════════════════════════════════════════════════════════════════════════

type Kind = "logo" | "hero";

const isKind = (v: unknown): v is Kind => v === "logo" || v === "hero";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;

  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const kind = form.get("kind");
  if (!isKind(kind)) return NextResponse.json({ error: "Unknown image kind." }, { status: 400 });

  const read = await readImageUpload(form);
  if (!read.ok) return read.response;

  try {
    // A fresh id per upload busts any CDN/browser cache of the replaced image —
    // reusing the key would leave owners looking at their old logo.
    const stored = await processAndStoreContentImage("gyms", `${gym.id}/${kind}-${randomUUID()}`, read.value.buffer);

    const previous = kind === "logo" ? gym.logoUrl : gym.heroUrl;
    const updated = await prisma.gym.update({
      where: { id: gym.id },
      data: kind === "logo" ? { logoUrl: stored.url } : { heroUrl: stored.url },
      select: { logoUrl: true, heroUrl: true },
    });

    // Best-effort cleanup of the replaced object. A failure here must not fail
    // the upload — the new image is already live and correct.
    if (previous) void deleteStored(previous).catch(() => {});

    return NextResponse.json({ ok: true, kind, url: stored.url, gym: updated });
  } catch (e) {
    log.warn({ gymId: gym.id, kind, err: (e as Error).message }, "gym:image-upload-failed");
    return NextResponse.json({ error: "Could not save the image. Please try again." }, { status: 500 });
  }
}

/** Remove the logo or hero. The stored object is deleted, not orphaned. */
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  const kind = new URL(req.url).searchParams.get("kind");
  if (!isKind(kind)) return NextResponse.json({ error: "Unknown image kind." }, { status: 400 });

  const previous = kind === "logo" ? gym.logoUrl : gym.heroUrl;
  const updated = await prisma.gym.update({
    where: { id: gym.id },
    data: kind === "logo" ? { logoUrl: null } : { heroUrl: null },
    select: { logoUrl: true, heroUrl: true },
  });
  if (previous) void deleteStored(previous).catch(() => {});

  return NextResponse.json({ ok: true, kind, gym: updated });
}
