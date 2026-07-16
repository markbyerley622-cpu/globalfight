// ═══════════════════════════════════════════════════════════════════════════
//  Community repository (Phase 1). A Community IS a ForumCategory — the official
//  ones are seeded by the forum (MMA, Boxing, BJJ…). This layer adds membership
//  (join/leave) and the "feed video → discussion thread" wiring. Threads, posts,
//  replies, reactions and realtime all reuse the existing forum repo unchanged.
// ═══════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { ensureForumSeed, createThread } from "@/lib/forum/repo";
import { parseEmbed } from "@/lib/forum/embeds";
export { suggestedCommunitySlug } from "@/lib/community/topics";

export interface CommunityDTO {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  threadCount: number;
  isMember: boolean;
}

export interface VideoDiscussionDTO {
  slug: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  locked: boolean;
  authorId: string;
  replyCount: number;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getCommunities(viewerId?: string): Promise<CommunityDTO[]> {
  await ensureForumSeed();
  const cats = await prisma.forumCategory.findMany({
    orderBy: { order: "asc" },
    include: { _count: { select: { threads: true } } },
  });
  const mine = viewerId
    ? new Set(
        (await prisma.communityMember.findMany({ where: { userId: viewerId }, select: { communityId: true } }))
          .map((m) => m.communityId),
      )
    : new Set<string>();
  return cats.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, description: c.description, icon: c.icon,
    avatarUrl: c.avatarUrl, bannerUrl: c.bannerUrl, memberCount: c.memberCount,
    threadCount: c._count.threads, isMember: mine.has(c.id),
  }));
}

export async function getCommunity(slug: string, viewerId?: string): Promise<CommunityDTO | null> {
  await ensureForumSeed();
  const c = await prisma.forumCategory.findUnique({
    where: { slug },
    include: { _count: { select: { threads: true } } },
  });
  if (!c) return null;
  const isMember = viewerId
    ? !!(await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: c.id, userId: viewerId } }, select: { id: true },
      }))
    : false;
  return {
    id: c.id, slug: c.slug, name: c.name, description: c.description, icon: c.icon,
    avatarUrl: c.avatarUrl, bannerUrl: c.bannerUrl, memberCount: c.memberCount,
    threadCount: c._count.threads, isMember,
  };
}

// ─── Membership ──────────────────────────────────────────────────────────────

export async function joinCommunity(slug: string, userId: string): Promise<{ isMember: boolean; memberCount: number }> {
  const c = await prisma.forumCategory.findUnique({ where: { slug }, select: { id: true, memberCount: true } });
  if (!c) throw new Error("Community not found.");
  const existing = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId: c.id, userId } }, select: { id: true },
  });
  if (existing) return { isMember: true, memberCount: c.memberCount };
  await prisma.communityMember.create({ data: { communityId: c.id, userId } });
  const updated = await prisma.forumCategory.update({
    where: { id: c.id }, data: { memberCount: { increment: 1 } }, select: { memberCount: true },
  });
  return { isMember: true, memberCount: updated.memberCount };
}

export async function leaveCommunity(slug: string, userId: string): Promise<{ isMember: boolean; memberCount: number }> {
  const c = await prisma.forumCategory.findUnique({ where: { slug }, select: { id: true, memberCount: true } });
  if (!c) throw new Error("Community not found.");
  const existing = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId: c.id, userId } }, select: { id: true },
  });
  if (!existing) return { isMember: false, memberCount: c.memberCount };
  await prisma.communityMember.delete({ where: { id: existing.id } });
  // Never let a decrement drive the counter negative (defensive).
  const next = Math.max(0, c.memberCount - 1);
  await prisma.forumCategory.update({ where: { id: c.id }, data: { memberCount: next } });
  return { isMember: false, memberCount: next };
}

// ─── Video discussions ───────────────────────────────────────────────────────

/** The primary discussion for a feed video (most-replied, then oldest), or null. */
export async function getVideoDiscussion(videoId: string): Promise<VideoDiscussionDTO | null> {
  const t = await prisma.forumThread.findFirst({
    where: { videoId },
    orderBy: [{ replyCount: "desc" }, { createdAt: "asc" }],
    select: {
      slug: true, title: true, locked: true, authorId: true, replyCount: true,
      category: { select: { slug: true, name: true } },
    },
  });
  if (!t) return null;
  return {
    slug: t.slug, title: t.title, categorySlug: t.category.slug, categoryName: t.category.name,
    locked: t.locked, authorId: t.authorId, replyCount: t.replyCount,
  };
}

export interface FeedVideoInput {
  id: string; title: string; channel?: string | null; channelId?: string | null;
  topic?: string | null; description?: string | null; tags?: string[];
}

/**
 * Start the primary discussion for a video in the chosen community. Idempotent-ish:
 * if a discussion already exists it's returned instead of creating a duplicate.
 * Upserts the FeedVideo row first so the thread's videoId FK resolves even when
 * the catalog row isn't present yet (e.g. mock/edge data).
 */
export async function createVideoDiscussion(input: {
  video: FeedVideoInput; communitySlug: string; userId: string; comment?: string;
}): Promise<VideoDiscussionDTO> {
  const existing = await getVideoDiscussion(input.video.id);
  if (existing) return existing;

  await prisma.feedVideo.upsert({
    where: { id: input.video.id },
    update: {},
    create: {
      id: input.video.id,
      title: input.video.title || "Untitled",
      channel: input.video.channel || "Unknown",
      channelId: input.video.channelId ?? undefined,
      topic: input.video.topic ?? undefined,
      description: input.video.description ?? undefined,
      tags: input.video.tags ?? [],
    },
  });

  const embed = parseEmbed(`https://www.youtube.com/watch?v=${input.video.id}`);
  const title = (input.video.title || "Fight discussion").slice(0, 155);
  const thread = await createThread({
    authorId: input.userId,
    categorySlug: input.communitySlug,
    title,
    content: input.comment?.trim() || "",
    attachments: embed ? [embed] : undefined,
    videoId: input.video.id,
  });
  return {
    slug: thread.slug, title: thread.title, categorySlug: thread.categorySlug,
    categoryName: thread.categoryName, locked: thread.locked, authorId: thread.authorId,
    replyCount: thread.replyCount,
  };
}
