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

/** Enough to show a gym; small enough that the page stays fast and the bucket
 *  doesn't become someone's photo host. */
const MAX_PHOTOS = 12;

/** The gym's gallery. Public — used by the gym page as well as the dashboard. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "No such gym." }, { status: 404 });

  const photos = await prisma.gymPhoto.findMany({
    where: { gymId: gym.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, url: true, thumbUrl: true, width: true, height: true, caption: true },
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
      select: { id: true, url: true, thumbUrl: true, width: true, height: true, caption: true },
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

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which photo?" }, { status: 400 });

  // Scoped to THIS gym: an id alone must not let an owner delete a row that
  // belongs to somebody else's gallery.
  const photo = await prisma.gymPhoto.findFirst({
    where: { id, gymId: gym.id },
    select: { id: true, url: true, thumbUrl: true },
  });
  if (!photo) return NextResponse.json({ error: "No such photo." }, { status: 404 });

  await prisma.gymPhoto.delete({ where: { id: photo.id } });
  void deleteStored(photo.url).catch(() => {});
  void deleteStored(photo.thumbUrl).catch(() => {});

  return NextResponse.json({ ok: true, id: photo.id });
}
