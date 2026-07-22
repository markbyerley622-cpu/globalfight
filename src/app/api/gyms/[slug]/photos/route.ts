import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { processAndStoreContentImage, deleteStored } from "@/lib/images/store";
import { readImageUpload } from "@/lib/images/upload-policy";
import { authoriseGymEdit } from "@/lib/geo/gym-auth";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough to show a gym; small enough that the page stays fast and the bucket
 *  doesn't become someone's photo host. */
const MAX_PHOTOS = 12;

// Local, not exported: a route module may only export HTTP handlers and config.
const PHOTO_SELECT = {
  id: true, url: true, thumbUrl: true, width: true, height: true,
  caption: true, alt: true, credit: true, takenAt: true, sortOrder: true,
} as const;

/** The gym's gallery. Public — used by the gym page as well as the dashboard. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "No such gym." }, { status: 404 });

  const photos = await prisma.gymPhoto.findMany({
    where: { gymId: gym.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: PHOTO_SELECT,
  });
  return NextResponse.json({ photos });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;

  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym, userId } = auth.value;

  const count = await prisma.gymPhoto.count({ where: { gymId: gym.id } });
  if (count >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `A gym can show ${MAX_PHOTOS} photos. Remove one to add another.` },
      { status: 409 },
    );
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const read = await readImageUpload(form);
  if (!read.ok) return read.response;

  try {
    const stored = await processAndStoreContentImage("gyms", `${gym.id}/photo-${randomUUID()}`, read.value.buffer);
    const caption = (form.get("caption") as string | null)?.trim().slice(0, 120) || null;

    const photo = await prisma.gymPhoto.create({
      data: {
        gymId: gym.id,
        url: stored.url,
        thumbUrl: stored.thumbUrl,
        // Stored so the gallery can reserve the right box before the image
        // loads — a gallery without intrinsic sizes reflows the page on every
        // arrival.
        width: stored.width,
        height: stored.height,
        caption,
        sortOrder: count,
        uploadedById: userId,
      },
      select: PHOTO_SELECT,
    });

    return NextResponse.json({ ok: true, photo }, { status: 201 });
  } catch (e) {
    log.warn({ gymId: gym.id, err: (e as Error).message }, "gym:photo-upload-failed");
    return NextResponse.json({ error: "Could not save the photo. Please try again." }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  // `id` may repeat for a bulk delete: ?id=a&id=b
  const ids = new URL(req.url).searchParams.getAll("id").filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ error: "Which photo?" }, { status: 400 });

  // Scoped to THIS gym: an id alone must not let an owner delete a row that
  // belongs to somebody else's gallery.
  const photos = await prisma.gymPhoto.findMany({
    where: { id: { in: ids }, gymId: gym.id },
    select: { id: true, url: true, thumbUrl: true },
  });
  if (photos.length === 0) return NextResponse.json({ error: "No such photo." }, { status: 404 });

  await prisma.gymPhoto.deleteMany({ where: { id: { in: photos.map((p) => p.id) }, gymId: gym.id } });
  for (const p of photos) {
    void deleteStored(p.url).catch(() => {});
    void deleteStored(p.thumbUrl).catch(() => {});
  }

  return NextResponse.json({ ok: true, ids: photos.map((p) => p.id) });
}

// ── Metadata + cover ────────────────────────────────────────────────────────

const Meta = z.object({
  id: z.string().min(1),
  caption: z.string().trim().max(160).nullable().optional(),
  alt: z.string().trim().max(200).nullable().optional(),
  credit: z.string().trim().max(80).nullable().optional(),
  takenAt: z.string().datetime().nullable().optional(),
  /** Promote this photo to the gym's hero image. */
  cover: z.literal(true).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  const parsed = Meta.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const { id, cover, ...meta } = parsed.data;

  const existing = await prisma.gymPhoto.findFirst({ where: { id, gymId: gym.id }, select: { id: true, url: true } });
  if (!existing) return NextResponse.json({ error: "No such photo." }, { status: 404 });

  const photo = await prisma.gymPhoto.update({
    where: { id: existing.id },
    data: {
      caption: meta.caption,
      alt: meta.alt,
      credit: meta.credit,
      takenAt: meta.takenAt === undefined ? undefined : meta.takenAt ? new Date(meta.takenAt) : null,
    },
    select: PHOTO_SELECT,
  });

  // Cover writes into the EXISTING heroUrl rather than adding a second notion
  // of "the main image" — so every public surface that already reads heroUrl
  // (gym page, map pin, search card) updates with no further wiring.
  let heroUrl: string | undefined;
  if (cover) {
    const updated = await prisma.gym.update({
      where: { id: gym.id },
      data: { heroUrl: existing.url },
      select: { heroUrl: true },
    });
    heroUrl = updated.heroUrl ?? undefined;
  }

  return NextResponse.json({ ok: true, photo, heroUrl });
}

// ── Ordering ────────────────────────────────────────────────────────────────

const Reorder = z.object({ order: z.array(z.string().min(1)).min(1).max(MAX_PHOTOS) });

/**
 * Persist a new order.
 *
 * Takes the FULL ordered id list and rejects it if the set no longer matches
 * what the gym actually has (409): if someone added or deleted a photo in
 * another tab since this list was rendered, applying it would resurrect a
 * stale order or drop a row's position silently. The client refetches instead.
 *
 * Only rows whose sortOrder actually CHANGES are written — dragging one tile
 * should not be 12 UPDATEs.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  const parsed = Reorder.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { order } = parsed.data;

  const current = await prisma.gymPhoto.findMany({
    where: { gymId: gym.id },
    select: { id: true, sortOrder: true },
  });

  const currentIds = new Set(current.map((p) => p.id));
  const sameSet = order.length === current.length && order.every((id) => currentIds.has(id));
  if (!sameSet) {
    return NextResponse.json(
      { error: "This gallery changed in another tab. Reload to reorder.", code: "STALE_ORDER" },
      { status: 409 },
    );
  }

  const bySortOrder = new Map(current.map((p) => [p.id, p.sortOrder]));
  const writes = order
    .map((id, index) => ({ id, index }))
    .filter(({ id, index }) => bySortOrder.get(id) !== index);

  if (writes.length > 0) {
    await prisma.$transaction(
      writes.map(({ id, index }) =>
        prisma.gymPhoto.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
  }

  return NextResponse.json({ ok: true, updated: writes.length });
}
