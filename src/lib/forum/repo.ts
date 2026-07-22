// ═══════════════════════════════════════════════════════════════════════════
//  Forum repository — fully DB-backed (NO mock fallback). Every mutation calls
//  publish(...) → pg_notify → all server instances → all SSE clients, so the
//  forum is realtime across devices.
//
//  Covers: threads/posts, media attachments, multi-type reactions (Phase 3),
//  nested + quoted replies (Phase 4), identity (Phase 5), bookmarks/follow
//  (Phase 6), share counts (Phase 7), trending + community feed (Phase 8/9),
//  and fighter/promoter post kinds (Phase 10/11).
// ═══════════════════════════════════════════════════════════════════════════

import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  FORUM_CATEGORY_SEED, REACTION_TYPES,
  type ForumCategoryDTO, type ForumThreadDTO, type ForumPostDTO, type Paginated,
  type ForumAttachment,
} from "@/lib/forum/types";
import { publish } from "@/lib/forum/realtime";
import { notify } from "@/lib/notifications-store";

// ─── Visibility ─────────────────────────────────────────────────────────────
// Battle rooms are ForumThreads with visibility="battle": same posts, reactions,
// quotes, realtime and moderation, but PRIVATE to the battle's two users. They
// must never appear in a category list, a feed, trending, or a bookmark list —
// so every listing query is scoped to public threads, in ONE place.
const PUBLIC_ONLY = { visibility: "public" } as const;

/** Loaded alongside a thread wherever access has to be decided. */
const ACCESS_SELECT = {
  visibility: true,
  battle: { select: { id: true, challengerId: true, opponentId: true, fightId: true } },
} as const;
type BattleRef = { id: string; challengerId: string; opponentId: string | null; fightId: string };
type AccessRow = { visibility: string; battle: BattleRef | null };

/** True when `viewerId` may read/post in this thread. */
function canAccessThread(t: AccessRow, viewerId?: string): boolean {
  if (t.visibility !== "battle") return true;
  if (!viewerId || !t.battle) return false;
  return t.battle.challengerId === viewerId || t.battle.opponentId === viewerId;
}

const slugifyThread = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "thread";

const stripToText = (s: string) => s.replace(/\s+/g, " ").trim();
const excerptOf = (s: string, n = 200) => {
  const t = stripToText(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const asAttachments = (v: unknown): ForumAttachment[] => (Array.isArray(v) ? (v as ForumAttachment[]) : []);

// ─── Includes ─────────────────────────────────────────────────────────────

const THREAD_AUTHOR = {
  select: {
    name: true, username: true, image: true, registryRole: true, role: true,
    fighterProfile: { select: { sport: true } },
  },
} as const;
const POST_AUTHOR = {
  select: {
    id: true, name: true, username: true, image: true, reputation: true, registryRole: true, role: true,
    fighterProfile: { select: { sport: true } },
  },
} as const;

const THREAD_INCLUDE = {
  author: THREAD_AUTHOR,
  category: { select: { name: true, slug: true } },
  // Opening post → feed preview (excerpt + first image). One extra row/thread.
  posts: {
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { content: true, attachments: true, deleted: true },
  },
} satisfies Prisma.ForumThreadInclude;

type ThreadRow = {
  id: string; slug: string; title: string; kind: string;
  pinned: boolean; locked: boolean; views: number; replyCount: number;
  shareCount: number; reactionCount: number;
  lastPostAt: Date; createdAt: Date; authorId: string;
  author: {
    name: string | null; username: string | null; image: string | null;
    registryRole: string; role: string; fighterProfile: { sport: string } | null;
  };
  category: { name: string; slug: string };
  posts?: { content: string; attachments: unknown; deleted: boolean }[];
};
type PostRow = {
  id: string; threadId: string; content: string; authorId: string; parentId: string | null;
  attachments: unknown; quotedId: string | null; quotedAuthor: string | null; quotedExcerpt: string | null;
  edited: boolean; deleted: boolean; likeCount: number; createdAt: Date;
  author: {
    id: string; name: string | null; username: string | null; image: string | null;
    reputation: number; registryRole: string; role: string; fighterProfile: { sport: string } | null;
  };
  reactions?: { type: string; userId: string }[];
};

// ─── Mappers ──────────────────────────────────────────────────────────────

function mapThread(t: ThreadRow, viewer?: { bookmarked: Set<string>; following: Set<string> }): ForumThreadDTO {
  const op = t.posts?.[0];
  const opAttachments = asAttachments(op?.attachments);
  const previewImage = opAttachments.find((a) => a.type === "image")?.thumbUrl
    ?? opAttachments.find((a) => a.type === "image")?.url
    ?? opAttachments.find((a) => a.type === "youtube")?.thumbUrl
    ?? null;
  return {
    id: t.id, slug: t.slug, title: t.title, kind: t.kind,
    categorySlug: t.category.slug, categoryName: t.category.name,
    authorName: t.author.name ?? t.author.username ?? "Member", authorId: t.authorId,
    authorRole: t.author.registryRole, authorAppRole: t.author.role,
    authorSport: t.author.fighterProfile?.sport ?? null,
    authorImage: t.author.image,
    pinned: t.pinned, locked: t.locked, views: t.views, replyCount: t.replyCount,
    shareCount: t.shareCount, reactionCount: t.reactionCount,
    lastPostAt: t.lastPostAt.toISOString(), createdAt: t.createdAt.toISOString(),
    bookmarked: viewer ? viewer.bookmarked.has(t.id) : undefined,
    following: viewer ? viewer.following.has(t.id) : undefined,
    excerpt: op && !op.deleted ? excerptOf(op.content) : null,
    previewImage,
  };
}

function mapPost(p: PostRow, viewerId?: string): ForumPostDTO {
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const r of p.reactions ?? []) {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
    if (viewerId && r.userId === viewerId) mine.push(r.type);
  }
  return {
    id: p.id, threadId: p.threadId, content: p.deleted ? "" : p.content,
    authorId: p.authorId, authorName: p.author.name ?? p.author.username ?? "Member",
    authorUsername: p.author.username, authorImage: p.author.image,
    authorRole: p.author.registryRole, authorAppRole: p.author.role,
    authorSport: p.author.fighterProfile?.sport ?? null,
    authorReputation: p.author.reputation,
    parentId: p.parentId,
    attachments: p.deleted ? [] : asAttachments(p.attachments),
    quote: p.quotedExcerpt
      ? { id: p.quotedId, author: p.quotedAuthor ?? "Member", excerpt: p.quotedExcerpt }
      : null,
    edited: p.edited, deleted: p.deleted,
    likeCount: counts.like ?? p.likeCount,
    reactedByMe: mine.includes("like"),
    reactions: counts, myReactions: mine,
    createdAt: p.createdAt.toISOString(),
  };
}

// ─── Seed ───────────────────────────────────────────────────────────────────

const RETIRED_CATEGORY_SLUGS = ["k1"];
let forumSeeded = false;
// Single-flight: the homepage renders several server components that each call
// ensureForumSeed concurrently. Sharing one promise stops parallel upserts from
// racing to create the same category (P2002 on the unique `name`/`slug`).
let forumSeedPromise: Promise<void> | null = null;
export async function ensureForumSeed(): Promise<void> {
  if (forumSeeded) return;
  forumSeedPromise ??= (async () => {
    for (const c of FORUM_CATEGORY_SEED) {
      await prisma.forumCategory.upsert({
        where: { slug: c.slug },
        update: { name: c.name, description: c.description, icon: c.icon, order: c.order },
        create: c,
      });
    }
    await prisma.forumCategory.deleteMany({ where: { slug: { in: RETIRED_CATEGORY_SLUGS } } }).catch(() => {});
    forumSeeded = true;
  })();
  try {
    await forumSeedPromise;
  } catch (e) {
    forumSeedPromise = null; // let a later call retry if seeding failed
    throw e;
  }
}

export async function getForumCategories(): Promise<ForumCategoryDTO[]> {
  await ensureForumSeed();
  const cats = await prisma.forumCategory.findMany({
    orderBy: { order: "asc" },
    include: { _count: { select: { threads: true } } },
  });
  return cats.map((c) => ({
    id: c.id, name: c.name, slug: c.slug, description: c.description,
    icon: c.icon, order: c.order, threadCount: c._count.threads,
  }));
}

// ─── Viewer flags helper ────────────────────────────────────────────────────

async function viewerFlags(viewerId: string | undefined, threadIds: string[]) {
  if (!viewerId || threadIds.length === 0) return undefined;
  const [bm, sub] = await Promise.all([
    prisma.forumBookmark.findMany({ where: { userId: viewerId, threadId: { in: threadIds } }, select: { threadId: true } }),
    prisma.forumSubscription.findMany({ where: { userId: viewerId, threadId: { in: threadIds } }, select: { threadId: true } }),
  ]);
  return { bookmarked: new Set(bm.map((b) => b.threadId)), following: new Set(sub.map((s) => s.threadId)) };
}

// ─── Threads (category list) ─────────────────────────────────────────────────

export async function getThreads(opts: {
  categorySlug?: string; cursor?: string; limit?: number; viewerId?: string;
}): Promise<Paginated<ForumThreadDTO>> {
  await ensureForumSeed();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await prisma.forumThread.findMany({
    where: opts.categorySlug ? { ...PUBLIC_ONLY, category: { slug: opts.categorySlug } } : PUBLIC_ONLY,
    orderBy: [{ pinned: "desc" }, { lastPostAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: THREAD_INCLUDE,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const flags = await viewerFlags(opts.viewerId, page.map((t) => t.id));
  return { items: page.map((t) => mapThread(t as ThreadRow, flags)), nextCursor: hasMore ? page[page.length - 1].id : null };
}

// ─── Community feed (Phase 8/9) ──────────────────────────────────────────────

export type FeedSort = "latest" | "trending" | "following" | "most-discussed" | "newest" | "most-liked";
export type FeedWindow = "today" | "week" | "month" | "all";

const WINDOW_MS: Record<FeedWindow, number> = {
  today: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, all: Number.POSITIVE_INFINITY,
};

/** Weighted heat score for trending. Shares and reactions count most. */
function hotScore(t: { views: number; replyCount: number; reactionCount: number; shareCount: number }) {
  return t.views * 0.5 + t.replyCount * 2 + t.reactionCount * 3 + t.shareCount * 5;
}

export async function getFeed(opts: {
  sort?: FeedSort; window?: FeedWindow; categorySlug?: string;
  cursor?: string; limit?: number; viewerId?: string;
}): Promise<Paginated<ForumThreadDTO>> {
  await ensureForumSeed();
  const sort = opts.sort ?? "latest";
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const where: Record<string, unknown> = opts.categorySlug
    ? { ...PUBLIC_ONLY, category: { slug: opts.categorySlug } }
    : { ...PUBLIC_ONLY };

  // "Following" needs a signed-in viewer and their subscriptions.
  if (sort === "following") {
    if (!opts.viewerId) return { items: [], nextCursor: null };
    const subs = await prisma.forumSubscription.findMany({ where: { userId: opts.viewerId }, select: { threadId: true } });
    where.id = { in: subs.map((s) => s.threadId) };
  }

  // Cursor-orderable sorts (DB sort + keyset pagination).
  const ORDER: Record<string, { orderBy: object[] } | null> = {
    latest: { orderBy: [{ lastPostAt: "desc" }, { id: "desc" }] },
    newest: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    following: { orderBy: [{ lastPostAt: "desc" }, { id: "desc" }] },
    "most-discussed": { orderBy: [{ replyCount: "desc" }, { id: "desc" }] },
    "most-liked": { orderBy: [{ reactionCount: "desc" }, { id: "desc" }] },
    trending: null, // computed below
  };

  if (sort !== "trending") {
    const rows = await prisma.forumThread.findMany({
      where, ...ORDER[sort]!, take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: THREAD_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const flags = await viewerFlags(opts.viewerId, page.map((t) => t.id));
    return { items: page.map((t) => mapThread(t as ThreadRow, flags)), nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  // Trending: window-scope by recent activity, score in JS, return top-N (single
  // page — honest about there being no deep pagination for a ranked list).
  const win = opts.window ?? "week";
  if (Number.isFinite(WINDOW_MS[win])) {
    where.lastPostAt = { gte: new Date(Date.now() - WINDOW_MS[win]) };
  }
  const rows = await prisma.forumThread.findMany({
    where, orderBy: [{ lastPostAt: "desc" }], take: 300, include: THREAD_INCLUDE,
  });
  const ranked = rows
    .map((t) => ({ t, score: hotScore(t) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
  const flags = await viewerFlags(opts.viewerId, ranked.map((t) => t.id));
  return { items: ranked.map((t) => mapThread(t as ThreadRow, flags)), nextCursor: null };
}

// ─── Single thread + posts ───────────────────────────────────────────────────

export async function getThread(slug: string, opts?: { incrementViews?: boolean; viewerId?: string }): Promise<ForumThreadDTO | null> {
  const t = await prisma.forumThread.findUnique({
    where: { slug },
    include: { ...THREAD_INCLUDE, battle: { select: ACCESS_SELECT.battle.select } },
  });
  if (!t) return null;
  // A battle room is invisible to anyone but its two fighters — 404, not 403, so
  // a stranger cannot even confirm the room exists.
  if (!canAccessThread(t, opts?.viewerId)) return null;
  if (opts?.incrementViews) {
    await prisma.forumThread.update({ where: { id: t.id }, data: { views: { increment: 1 } } }).catch(() => {});
  }
  const flags = await viewerFlags(opts?.viewerId, [t.id]);
  return mapThread(t as ThreadRow, flags);
}

export async function getPosts(threadSlug: string, opts: {
  cursor?: string; limit?: number; viewerId?: string;
}): Promise<Paginated<ForumPostDTO>> {
  const thread = await prisma.forumThread.findUnique({
    where: { slug: threadSlug }, select: { id: true, ...ACCESS_SELECT },
  });
  if (!thread || !canAccessThread(thread, opts.viewerId)) return { items: [], nextCursor: null };
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await prisma.forumPost.findMany({
    where: { threadId: thread.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { author: POST_AUTHOR, reactions: { select: { type: true, userId: true } } },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((p) => mapPost(p as PostRow, opts.viewerId)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// ─── Mutations: threads ──────────────────────────────────────────────────────

// Roles whose threads are treated as fighter/promoter "posts" in the feed.
function threadKindFor(role: string, requested?: string): string {
  if (requested && ["discussion", "fighter_post", "promoter_post", "announcement"].includes(requested)) {
    if (requested === "fighter_post" && role !== "fighter") return "discussion";
    if (requested === "promoter_post" && role !== "promoter") return "discussion";
    return requested;
  }
  return "discussion";
}

export async function createThread(input: {
  authorId: string; categorySlug: string; title: string; content: string;
  attachments?: ForumAttachment[]; kind?: string; videoId?: string;
  fighterId?: string; promotion?: string;
  /** Room links — an event's general room, a fight's arena, a battle's room. */
  eventId?: string; fightId?: string; battleId?: string; visibility?: "public" | "battle";
}): Promise<ForumThreadDTO> {
  await ensureForumSeed();
  const category = await prisma.forumCategory.findUnique({
    where: { slug: input.categorySlug }, select: { id: true, slug: true },
  });
  if (!category) throw new Error("Unknown category.");
  const author = await prisma.user.findUnique({ where: { id: input.authorId }, select: { registryRole: true } });
  const kind = threadKindFor(author?.registryRole ?? "fan", input.kind);

  const base = slugifyThread(input.title);
  let slug = base;
  for (let i = 2; await prisma.forumThread.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  const thread = await prisma.forumThread.create({
    data: {
      slug, title: input.title.trim(), categoryId: category.id, authorId: input.authorId, kind,
      videoId: input.videoId ?? undefined,
      fighterId: input.fighterId ?? undefined,
      promotion: input.promotion ?? undefined,
      eventId: input.eventId ?? undefined,
      fightId: input.fightId ?? undefined,
      battleId: input.battleId ?? undefined,
      visibility: input.visibility ?? "public",
      posts: { create: { authorId: input.authorId, content: input.content.trim(), attachments: input.attachments ?? undefined } },
    },
    include: THREAD_INCLUDE,
  });
  // A private battle room is never announced to the category — only its two
  // participants are told about it (via notify, from the battle domain).
  if ((input.visibility ?? "public") === "public") {
    await publish({ type: "thread:new", categorySlug: category.slug, threadSlug: slug, title: thread.title });
  }
  return mapThread(thread as ThreadRow);
}

export async function deleteThread(input: {
  threadSlug: string; userId: string; isAdmin?: boolean;
}): Promise<{ categorySlug: string }> {
  const thread = await prisma.forumThread.findUnique({
    where: { slug: input.threadSlug },
    select: { id: true, authorId: true, category: { select: { slug: true } } },
  });
  if (!thread) throw new Error("Thread not found.");
  if (thread.authorId !== input.userId && !input.isAdmin) throw new Error("You can only delete your own threads.");
  await prisma.forumThread.delete({ where: { id: thread.id } });
  await publish({ type: "thread:delete", categorySlug: thread.category.slug, threadSlug: input.threadSlug });
  return { categorySlug: thread.category.slug };
}

// ─── Mutations: posts ────────────────────────────────────────────────────────

export async function createPost(input: {
  authorId: string; threadSlug: string; content: string; parentId?: string | null;
  attachments?: ForumAttachment[]; quotePostId?: string | null;
}): Promise<ForumPostDTO> {
  const thread = await prisma.forumThread.findUnique({
    where: { slug: input.threadSlug }, select: { id: true, locked: true, ...ACCESS_SELECT },
  });
  if (!thread) throw new Error("Thread not found.");
  if (!canAccessThread(thread, input.authorId)) throw new Error("Thread not found.");
  if (thread.locked) throw new Error("This thread is locked.");

  // Snapshot the quoted post so the quote survives later edits/deletes.
  let quote: { quotedId: string; quotedAuthor: string; quotedExcerpt: string } | undefined;
  if (input.quotePostId) {
    const q = await prisma.forumPost.findFirst({
      where: { id: input.quotePostId, threadId: thread.id, deleted: false },
      select: { id: true, content: true, author: { select: { name: true, username: true } } },
    });
    if (q) {
      quote = {
        quotedId: q.id,
        quotedAuthor: q.author.name ?? q.author.username ?? "Member",
        quotedExcerpt: excerptOf(q.content, 240),
      };
    }
  }

  const post = await prisma.forumPost.create({
    data: {
      threadId: thread.id, authorId: input.authorId,
      content: input.content.trim(), parentId: input.parentId ?? null,
      attachments: input.attachments ?? undefined,
      ...quote,
    },
    include: { author: POST_AUTHOR, reactions: { select: { type: true, userId: true } } },
  });
  await prisma.forumThread.update({
    where: { id: thread.id }, data: { replyCount: { increment: 1 }, lastPostAt: new Date() },
  });
  if (thread.battle) await onBattleRoomMessage(thread.battle, input.authorId, post.content);
  await publish({ type: "post:new", threadSlug: input.threadSlug, postId: post.id });
  return mapPost(post as PostRow, input.authorId);
}

/**
 * A message landed in a private battle room: keep the battle/rivalry message
 * tallies honest and poke the rival. Best-effort — a notification hiccup must
 * never fail the post that was already written.
 */
async function onBattleRoomMessage(battle: BattleRef, authorId: string, content: string): Promise<void> {
  const rivalId = battle.challengerId === authorId ? battle.opponentId : battle.challengerId;
  try {
    await prisma.battle.update({ where: { id: battle.id }, data: { messageCount: { increment: 1 } } });
    if (!rivalId) return;
    const [x, y] = authorId < rivalId ? [authorId, rivalId] : [rivalId, authorId];
    await prisma.rivalry.updateMany({ where: { userAId: x, userBId: y }, data: { totalMessages: { increment: 1 } } });
    const me = await prisma.user.findUnique({ where: { id: authorId }, select: { name: true, username: true } });
    const fight = await prisma.fight.findUnique({ where: { id: battle.fightId }, select: { slug: true, event: { select: { slug: true } } } });
    await notify(prisma, rivalId, {
      type: "BATTLE_REPLY",
      title: `${me?.name ?? me?.username ?? "Your rival"} hit back`,
      body: content.slice(0, 120),
      url: fight?.event ? `/events/${fight.event.slug}#fight-${fight.slug}` : "/",
      icon: "🥊",
    });
  } catch { /* non-fatal */ }
}

export async function editPost(input: {
  postId: string; userId: string; isAdmin?: boolean; content: string;
}): Promise<ForumPostDTO> {
  const post = await prisma.forumPost.findUnique({
    where: { id: input.postId }, select: { authorId: true, thread: { select: { slug: true } } },
  });
  if (!post) throw new Error("Post not found.");
  if (post.authorId !== input.userId && !input.isAdmin) throw new Error("You can only edit your own posts.");
  const updated = await prisma.forumPost.update({
    where: { id: input.postId }, data: { content: input.content.trim(), edited: true },
    include: { author: POST_AUTHOR, reactions: { select: { type: true, userId: true } } },
  });
  await publish({ type: "post:edit", threadSlug: post.thread.slug, postId: input.postId });
  return mapPost(updated as PostRow, input.userId);
}

export async function deletePost(input: {
  postId: string; userId: string; isAdmin?: boolean;
}): Promise<void> {
  const post = await prisma.forumPost.findUnique({
    where: { id: input.postId },
    select: { authorId: true, threadId: true, reactions: { select: { id: true } }, thread: { select: { slug: true } } },
  });
  if (!post) throw new Error("Post not found.");
  if (post.authorId !== input.userId && !input.isAdmin) throw new Error("You can only delete your own posts.");
  await prisma.forumPost.update({ where: { id: input.postId }, data: { deleted: true, content: "", attachments: undefined } });
  // Keep the thread's reaction tally honest when a reacted post is removed.
  if (post.reactions.length) {
    await prisma.forumThread.update({ where: { id: post.threadId }, data: { reactionCount: { decrement: post.reactions.length } } }).catch(() => {});
  }
  await publish({ type: "post:delete", threadSlug: post.thread.slug, postId: input.postId });
}

// ─── Reactions (Phase 3) ─────────────────────────────────────────────────────

export async function addReaction(input: {
  postId: string; userId: string; type?: string;
}): Promise<{ reactions: Record<string, number>; myReactions: string[]; likeCount: number; reacted: boolean }> {
  const type = REACTION_TYPES.includes((input.type ?? "like") as never) ? (input.type ?? "like") : "like";
  const key = { postId_userId_type: { postId: input.postId, userId: input.userId, type } };
  const existing = await prisma.forumReaction.findUnique({ where: key, select: { id: true } });

  const post = await prisma.forumPost.findUnique({ where: { id: input.postId }, select: { threadId: true } });
  if (!post) throw new Error("Post not found.");

  // Conflict-TOLERANT toggle. Read-then-write is a check-then-act race, and
  // reacting is the highest-frequency write in the forum: eight concurrent
  // reactions produced six 400s against a live database (`create` hitting
  // @@unique([postId,userId,type]), `delete` hitting an already-deleted row).
  // deleteMany cannot throw, and a lost create race means the reaction the
  // caller wanted already exists.
  let reacted: boolean;
  if (existing) {
    await prisma.forumReaction.deleteMany({ where: { postId: input.postId, userId: input.userId, type } });
    reacted = false;
  } else {
    try {
      await prisma.forumReaction.create({ data: { postId: input.postId, userId: input.userId, type } });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    reacted = true;
  }

  // reactionCount is RECOMPUTED, not incremented. Under the races above an
  // increment/decrement drifts permanently, and reactionCount feeds hotScore()
  // — so drift here silently distorts what trends.
  const reactionCount = await prisma.forumReaction.count({
    where: { post: { threadId: post.threadId } },
  });
  await prisma.forumThread
    .update({ where: { id: post.threadId }, data: { reactionCount } })
    .catch(() => {});

  const all = await prisma.forumReaction.findMany({ where: { postId: input.postId }, select: { type: true, userId: true } });
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const r of all) {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
    if (r.userId === input.userId) mine.push(r.type);
  }
  const likeCount = counts.like ?? 0;
  await prisma.forumPost.update({ where: { id: input.postId }, data: { likeCount }, select: { id: true } });

  const thread = await prisma.forumPost.findUnique({ where: { id: input.postId }, select: { thread: { select: { slug: true } } } });
  if (thread) await publish({ type: "post:react", threadSlug: thread.thread.slug, postId: input.postId });
  return { reactions: counts, myReactions: mine, likeCount, reacted };
}

// ─── Bookmarks / Follow / Share (Phase 6/7) ──────────────────────────────────

async function threadIdBySlug(slug: string): Promise<string> {
  const t = await prisma.forumThread.findUnique({ where: { slug }, select: { id: true } });
  if (!t) throw new Error("Thread not found.");
  return t.id;
}

export async function toggleBookmark(threadSlug: string, userId: string): Promise<{ bookmarked: boolean }> {
  const threadId = await threadIdBySlug(threadSlug);
  const existing = await prisma.forumBookmark.findUnique({ where: { threadId_userId: { threadId, userId } }, select: { id: true } });
  if (existing) { await prisma.forumBookmark.delete({ where: { id: existing.id } }); return { bookmarked: false }; }
  await prisma.forumBookmark.create({ data: { threadId, userId } });
  return { bookmarked: true };
}

export async function toggleSubscription(threadSlug: string, userId: string): Promise<{ following: boolean }> {
  const threadId = await threadIdBySlug(threadSlug);
  const existing = await prisma.forumSubscription.findUnique({ where: { threadId_userId: { threadId, userId } }, select: { id: true } });
  if (existing) { await prisma.forumSubscription.delete({ where: { id: existing.id } }); return { following: false }; }
  await prisma.forumSubscription.create({ data: { threadId, userId } });
  return { following: true };
}

export async function recordShare(threadSlug: string): Promise<{ shareCount: number }> {
  const t = await prisma.forumThread.update({
    where: { slug: threadSlug }, data: { shareCount: { increment: 1 } }, select: { shareCount: true },
  });
  return { shareCount: t.shareCount };
}

export async function listBookmarks(userId: string, opts?: { limit?: number; cursor?: string }): Promise<Paginated<ForumThreadDTO>> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  const rows = await prisma.forumBookmark.findMany({
    where: { userId, thread: PUBLIC_ONLY }, orderBy: { createdAt: "desc" }, take: limit + 1,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, thread: { include: THREAD_INCLUDE } },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const flags = { bookmarked: new Set(page.map((r) => r.thread.id)), following: new Set<string>() };
  return { items: page.map((r) => mapThread(r.thread as ThreadRow, flags)), nextCursor: hasMore ? page[page.length - 1].id : null };
}

// ─── Reports (Phase 6) ───────────────────────────────────────────────────────

export async function createReport(input: {
  reporterId: string; targetType: "thread" | "post"; targetId: string; reason: string; detail?: string;
}): Promise<void> {
  await prisma.forumReport.upsert({
    where: { targetType_targetId_reporterId: { targetType: input.targetType, targetId: input.targetId, reporterId: input.reporterId } },
    create: {
      targetType: input.targetType, targetId: input.targetId, reporterId: input.reporterId,
      reason: input.reason, detail: input.detail ?? null,
    },
    update: { reason: input.reason, detail: input.detail ?? null, status: "OPEN" },
  });
}
