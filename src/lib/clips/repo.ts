// ═══════════════════════════════════════════════════════════════════════════
//  Combat Clips repository — user-uploaded native-video reels + community rating.
// ═══════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";

export interface ClipDTO {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl: string | null;
  topic: string | null;
  communitySlug: string | null;
  communityName: string | null;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  ratingAvg: number;   // 0 when unrated
  ratingCount: number;
  myRating: number | null;
  createdAt: string;
}

type ClipRow = {
  id: string; title: string; videoUrl: string; posterUrl: string | null; topic: string | null;
  authorId: string; ratingSum: number; ratingCount: number; createdAt: Date;
  author: { name: string | null; username: string | null; image: string | null };
  community: { slug: string; name: string } | null;
  ratings?: { value: number }[];
};

function mapClip(c: ClipRow): ClipDTO {
  return {
    id: c.id, title: c.title, videoUrl: c.videoUrl, posterUrl: c.posterUrl, topic: c.topic,
    communitySlug: c.community?.slug ?? null, communityName: c.community?.name ?? null,
    authorId: c.authorId, authorName: c.author.name ?? c.author.username ?? "Member", authorImage: c.author.image,
    ratingAvg: c.ratingCount > 0 ? c.ratingSum / c.ratingCount : 0,
    ratingCount: c.ratingCount,
    myRating: c.ratings && c.ratings.length ? c.ratings[0].value : null,
    createdAt: c.createdAt.toISOString(),
  };
}

const CLIP_INCLUDE = (viewerId?: string) => ({
  author: { select: { name: true, username: true, image: true } },
  community: { select: { slug: true, name: true } },
  ...(viewerId ? { ratings: { where: { userId: viewerId }, select: { value: true }, take: 1 } } : {}),
});

export async function listClips(opts: { cursor?: string; limit?: number; viewerId?: string; communitySlug?: string }): Promise<{ items: ClipDTO[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 30);
  const rows = await prisma.clip.findMany({
    where: { status: "ready", ...(opts.communitySlug ? { community: { slug: opts.communitySlug } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: CLIP_INCLUDE(opts.viewerId),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map((r) => mapClip(r as ClipRow)), nextCursor: hasMore ? page[page.length - 1].id : null };
}

export async function createClip(input: {
  authorId: string; title: string; videoUrl: string; posterUrl?: string | null;
  topic?: string | null; communitySlug?: string | null; durationSec?: number | null;
}): Promise<ClipDTO> {
  let communityId: string | undefined;
  if (input.communitySlug) {
    const c = await prisma.forumCategory.findUnique({ where: { slug: input.communitySlug }, select: { id: true } });
    communityId = c?.id;
  }
  const clip = await prisma.clip.create({
    data: {
      authorId: input.authorId, title: input.title.trim().slice(0, 160), videoUrl: input.videoUrl,
      posterUrl: input.posterUrl ?? undefined, topic: input.topic ?? undefined,
      communityId, durationSec: input.durationSec ?? undefined,
    },
    include: CLIP_INCLUDE(input.authorId),
  });
  return mapClip(clip as ClipRow);
}

/** Upsert the viewer's rating (1–5) for a clip and return fresh aggregates. */
export async function rateClip(input: { clipId: string; userId: string; value: number }): Promise<{ ratingAvg: number; ratingCount: number; myRating: number }> {
  const value = Math.max(1, Math.min(5, Math.round(input.value)));
  const clip = await prisma.clip.findUnique({ where: { id: input.clipId }, select: { id: true } });
  if (!clip) throw new Error("Clip not found.");

  const existing = await prisma.clipRating.findUnique({
    where: { clipId_userId: { clipId: input.clipId, userId: input.userId } }, select: { value: true },
  });
  if (existing) {
    await prisma.clipRating.update({ where: { clipId_userId: { clipId: input.clipId, userId: input.userId } }, data: { value } });
    await prisma.clip.update({ where: { id: input.clipId }, data: { ratingSum: { increment: value - existing.value } } });
  } else {
    await prisma.clipRating.create({ data: { clipId: input.clipId, userId: input.userId, value } });
    await prisma.clip.update({ where: { id: input.clipId }, data: { ratingSum: { increment: value }, ratingCount: { increment: 1 } } });
  }
  const fresh = await prisma.clip.findUnique({ where: { id: input.clipId }, select: { ratingSum: true, ratingCount: true } });
  const count = fresh?.ratingCount ?? 0;
  return { ratingAvg: count > 0 ? (fresh!.ratingSum) / count : 0, ratingCount: count, myRating: value };
}
