import "server-only";
// Value import, not `import type`: clearing a Json column needs Prisma.DbNull,
// which is a runtime sentinel. `null` would be rejected as ambiguous.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveDraftEntities, hydrateEntities } from "@/lib/rich-text/resolve";
import type { RichEntity } from "@/lib/rich-text/types";
import { isAdminRole } from "@/lib/admin/roles";
import { publicDisplayName } from "@/lib/display-name";
import { assertPublishable } from "@/lib/moderation/text";
import {
  MAX_BODY_CHARS, MAX_COMMENT_CHARS, FEED_PAGE_SIZE, FEED_PAGE_MAX,
  COMMENT_PAGE_SIZE, COMMENT_PAGE_MAX, isReactionType, isVisibility,
  type GymPostDTO, type GymPostCommentDTO, type Page, type PostAuthorDTO,
  type ReactionType, type Visibility,
} from "./types";
import { decodeCursor, seekWhere, seekOrderBy, takePage, pageSize } from "./cursor";
import { rankFeed, contentKeyOf, type Rankable } from "./ranking";
import {
  canViewPost, canEditPost, canDeletePost, canInteract,
  canCreatePost, canEditComment, canDeleteComment, ANONYMOUS, type Viewer,
} from "./visibility";
import { gymContext, viewerFor, membershipsFor, type Principal } from "./authorise";
import {
  normaliseAttachments, assertAttachable, attachMedia, detachAllMedia, detachMedia,
  renderMedia, widestOf, MEDIA_INCLUDE,
} from "./media";
import {
  notifyPostComment, notifyPostMention, notifyPostReaction, notifyCommentReaction,
  notifyPostShare, type PostRef,
} from "./notify";
import { forbidden, notFound } from "./errors";

// ════════════════════════════════════════════════════════════════════════════
//  GYM POSTS — the service layer.
//
//  Every rule is enforced HERE, not in a route handler, for the reason
//  CLAUDE.md already gives about ownership and lib/moderation/text already gives
//  about comments: a check bolted onto one route leaves every other caller open,
//  and there will be other callers (a server component, a moderation tool, a
//  future mobile endpoint). Routes in this domain do four things — authenticate,
//  parse, rate-limit, call — and hold no policy of their own.
//
//  ── Query budget ─────────────────────────────────────────────────────────
//  Every list read here is CONSTANT in queries regardless of page size:
//
//    feed page  = viewer scope (2) + posts+media+author+gym (1)
//                 + reaction tallies (1) + viewer's own reactions (1)   = 5
//    comments   = comments+authors (1) + tallies (1) + mine (1)         = 3
//
//  Nothing loops a query over rows. The two viewer-scope reads are what let the
//  visibility filter run in SQL instead of loading rows the caller may not see
//  and discarding them in JS — which would make `take` a lie and the page short.
// ════════════════════════════════════════════════════════════════════════════

const AUTHOR_SELECT = {
  id: true, name: true, username: true, image: true, registryRole: true, reputation: true,
} as const;

const GYM_SELECT = { id: true, slug: true, name: true, logoUrl: true, verified: true } as const;

const POST_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  gym: { select: GYM_SELECT },
  media: MEDIA_INCLUDE,
} satisfies Prisma.GymPostInclude;

type PostRow = Prisma.GymPostGetPayload<{ include: typeof POST_INCLUDE }>;

const mapAuthor = (a: PostRow["author"]): PostAuthorDTO => ({
  id: a.id,
  // publicDisplayName, never `name ?? username`: User.name holds whatever was
  // typed at signup and people type their email address into it.
  name: publicDisplayName(a),
  username: a.username,
  image: a.image,
  registryRole: a.registryRole,
});

// ─── Viewer scoping ─────────────────────────────────────────────────────────

interface Scope {
  viewer: (gymId: string, gymOwnerId: string | null) => Viewer;
  /** The SQL filter that keeps invisible posts out of the result entirely. */
  where: Prisma.GymPostWhereInput;
}

/**
 * Build the viewer's scope once per request.
 *
 * The visibility RULE lives in visibility.ts and is pure; this is its SQL
 * shadow, and the two must agree. They are kept honest by the pure predicate
 * being applied again on every row that comes back (see `visible` below) — so
 * if this filter is ever too generous, the rendered result is still correct.
 * Belt and braces on purpose: the filter is an optimisation, the predicate is
 * the control.
 */
async function buildScope(user: Principal | null): Promise<Scope> {
  if (!user) {
    return {
      viewer: () => ANONYMOUS,
      where: { deletedAt: null, visibility: "PUBLIC" },
    };
  }

  const [memberships, owned] = await Promise.all([
    prisma.gymMember.findMany({ where: { userId: user.id }, select: { gymId: true } }),
    prisma.gym.findMany({ where: { ownerId: user.id }, select: { id: true } }),
  ]);
  const memberOf = new Set(memberships.map((m) => m.gymId));
  const ownerOf = new Set(owned.map((g) => g.id));

  const viewer = (gymId: string, gymOwnerId: string | null): Viewer =>
    viewerFor(user, gymOwnerId ?? (ownerOf.has(gymId) ? user.id : null), memberOf.has(gymId));

  // Staff see every live post, in every gym, at every visibility — moderation
  // cannot work against a filtered view. They never see DELETED ones here; that
  // is the console's job and it logs the read.
  if (isAdminRole(user.role)) return { viewer, where: { deletedAt: null } };

  const gymScope = [...new Set([...memberOf, ...ownerOf])];
  return {
    viewer,
    where: {
      deletedAt: null,
      OR: [
        { visibility: "PUBLIC" },
        ...(gymScope.length ? [{ visibility: "MEMBERS" as const, gymId: { in: gymScope } }] : []),
        // PRIVATE: the author always, plus the owner of the gym it sits on.
        { visibility: "PRIVATE", authorId: user.id },
        ...(ownerOf.size ? [{ visibility: "PRIVATE" as const, gymId: { in: [...ownerOf] } }] : []),
        // A member's own MEMBERS post survives them leaving the gym.
        { visibility: "MEMBERS", authorId: user.id },
      ],
    },
  };
}

/** The pure predicate, applied to a row we actually loaded. */
const visible = (row: PostRow, scope: Scope, ownerId: string | null) =>
  canViewPost(
    { authorId: row.authorId, gymId: row.gymId, visibility: row.visibility as Visibility, deletedAt: row.deletedAt },
    scope.viewer(row.gymId, ownerId),
  );

// ─── Reaction tallies ───────────────────────────────────────────────────────

interface Tallies {
  counts: Map<string, Record<string, number>>;
  mine: Map<string, ReactionType[]>;
}

/** Per-type counts for a whole page, plus the viewer's own — two queries. */
async function postTallies(postIds: string[], userId: string | null): Promise<Tallies> {
  if (postIds.length === 0) return { counts: new Map(), mine: new Map() };
  const [grouped, own] = await Promise.all([
    prisma.gymPostReaction.groupBy({
      by: ["postId", "type"],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    }),
    userId
      ? prisma.gymPostReaction.findMany({
          where: { postId: { in: postIds }, userId },
          select: { postId: true, type: true },
        })
      : Promise.resolve([]),
  ]);
  return foldTallies(
    grouped.map((g) => ({ key: g.postId, type: g.type, n: g._count._all })),
    own.map((r) => ({ key: r.postId, type: r.type })),
  );
}

async function commentTallies(commentIds: string[], userId: string | null): Promise<Tallies> {
  if (commentIds.length === 0) return { counts: new Map(), mine: new Map() };
  const [grouped, own] = await Promise.all([
    prisma.gymPostCommentReaction.groupBy({
      by: ["commentId", "type"],
      where: { commentId: { in: commentIds } },
      _count: { _all: true },
    }),
    userId
      ? prisma.gymPostCommentReaction.findMany({
          where: { commentId: { in: commentIds }, userId },
          select: { commentId: true, type: true },
        })
      : Promise.resolve([]),
  ]);
  return foldTallies(
    grouped.map((g) => ({ key: g.commentId, type: g.type, n: g._count._all })),
    own.map((r) => ({ key: r.commentId, type: r.type })),
  );
}

function foldTallies(
  grouped: { key: string; type: string; n: number }[],
  own: { key: string; type: string }[],
): Tallies {
  const counts = new Map<string, Record<string, number>>();
  for (const g of grouped) {
    const bucket = counts.get(g.key) ?? {};
    bucket[g.type] = g.n;
    counts.set(g.key, bucket);
  }
  const mine = new Map<string, ReactionType[]>();
  for (const r of own) {
    if (!isReactionType(r.type)) continue;
    mine.set(r.key, [...(mine.get(r.key) ?? []), r.type]);
  }
  return { counts, mine };
}

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapPost(row: PostRow, viewer: Viewer, tallies: Tallies): GymPostDTO {
  const subject = {
    authorId: row.authorId, gymId: row.gymId,
    visibility: row.visibility as Visibility, deletedAt: row.deletedAt,
  };
  return {
    id: row.id,
    gym: row.gym,
    author: mapAuthor(row.author),
    body: row.body,
    // Raw here; hydrated by whichever read is returning this row. Mapping is
    // synchronous on purpose — the refresh is one batched query per PAGE, so it
    // cannot live in a per-row mapper without becoming a query per post.
    entities: row.entities ?? null,
    visibility: row.visibility as Visibility,
    pinned: row.pinned,
    media: renderMedia(row.media),
    commentCount: row.commentCount,
    reactionCount: row.reactionCount,
    shareCount: row.shareCount,
    reactions: tallies.counts.get(row.id) ?? {},
    myReactions: tallies.mine.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    // Resolved server-side. A UI that re-derives "can I edit this" from the ids
    // it happens to hold is a UI that will eventually disagree with the API.
    canEdit: canEditPost(subject, viewer),
    canDelete: canDeletePost(subject, viewer),
  };
}

/**
 * Refresh the display hints on a whole page of bodies, in ONE query.
 *
 * Every read that returns text goes through here — posts and comments alike —
 * so a rename applies to a feed exactly as it applies to a comment thread.
 * Batched by construction: hydrating inside `mapPost` would read the user table
 * once per row, which is the N+1 this exists to prevent.
 *
 * An empty result is stored as `null` rather than `[]` so "no entities" has one
 * representation on the wire, and the renderer's legacy fallback is reached by
 * the same check for new content as for old.
 */
async function hydratePage<T extends { body: string; entities?: unknown }>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  const hydrated = await hydrateEntities(items.map((i) => ({ text: i.body, entities: i.entities })));
  items.forEach((item, i) => { item.entities = hydrated[i].length ? hydrated[i] : null; });
  return items;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export interface FeedQuery {
  /** Scope to one gym. Omitted = the cross-gym feed. */
  gymSlug?: string | null;
  cursor?: string | null;
  limit?: number;
  user?: Principal | null;
}

/**
 * A page of the feed.
 *
 * Recency-keyset for the PAGE BOUNDARY, ranking WITHIN the page. That split is
 * the whole design and it is worth being precise about:
 *
 *   • the boundary must be keyset or pagination breaks under writes — a feed is
 *     written to constantly, and offset paging on a list that grows at the head
 *     shows a reader the same post twice and hides another;
 *   • ranking a wider candidate window and returning the best N would have to
 *     DISCARD the rest, and a discarded post is one nobody ever sees.
 *
 * So nothing is dropped, nothing repeats, and the ranker does what it can
 * usefully do at this scale: break up runs from one gym and lift the posts
 * people actually engaged with to the top of the screen they are on. Global
 * score ordering needs a materialised column and a recompute schedule — see
 * ranking.ts and docs/ARCHITECTURE.md.
 */
export async function getFeed(q: FeedQuery = {}): Promise<Page<GymPostDTO>> {
  const limit = pageSize(q.limit, FEED_PAGE_SIZE, FEED_PAGE_MAX);
  const user = q.user ?? null;
  const scope = await buildScope(user);

  let gymOwnerId: string | null = null;
  const where: Prisma.GymPostWhereInput = { ...scope.where };
  if (q.gymSlug) {
    const gym = await prisma.gym.findUnique({
      where: { slug: q.gymSlug },
      select: { id: true, ownerId: true },
    });
    if (!gym) return { items: [], nextCursor: null };
    gymOwnerId = gym.ownerId;
    where.gymId = gym.id;
  }

  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.gymPost.findMany({
    where: { ...where, ...seekWhere(cursor, "older") },
    orderBy: seekOrderBy("older"),
    take: limit + 1,
    include: POST_INCLUDE,
  });

  const { items: pageRows, nextCursor } = takePage(rows, limit);
  // The SQL filter is an optimisation; this is the control. See buildScope.
  const allowed = pageRows.filter((r) => visible(r, scope, gymOwnerId));

  const tallies = await postTallies(allowed.map((r) => r.id), user?.id ?? null);
  const rendered = allowed.map((r) => ({ row: r, dto: mapPost(r, scope.viewer(r.gymId, gymOwnerId), tallies) }));

  const rankable: (Rankable & { dto: GymPostDTO })[] = rendered.map(({ row, dto }) => ({
    id: row.id,
    gymId: row.gymId,
    createdAt: row.createdAt,
    reactionCount: row.reactionCount,
    commentCount: row.commentCount,
    shareCount: row.shareCount,
    mediaCount: dto.media.length,
    widestMedia: widestOf(dto.media),
    authorReputation: row.author.reputation,
    contentKey: contentKeyOf(row.body, row.media.map((m) => m.asset.id)),
    dto,
  }));

  // A gym's pinned post holds the top of ITS OWN first page and is exempt from
  // both scoring and diversity — pinning is an explicit editorial act by the
  // gym's owner, and a ranker that could overrule it would make the button lie.
  // Never applied to the cross-gym feed: one gym's pin is not everyone's.
  const pinned = q.gymSlug && !cursor ? rankable.filter((r) => r.dto.pinned) : [];
  const pinnedIds = new Set(pinned.map((r) => r.id));
  const rest = rankFeed(rankable.filter((r) => !pinnedIds.has(r.id)));

  const items = await hydratePage([...pinned, ...rest].map((r) => r.dto));
  return { items, nextCursor };
}

/** One post, or null when it does not exist or the viewer may not see it. */
export async function getPost(id: string, user: Principal | null): Promise<GymPostDTO | null> {
  const row = await prisma.gymPost.findUnique({ where: { id }, include: POST_INCLUDE });
  if (!row || row.deletedAt) return null;

  const [gym, memberships] = await Promise.all([
    prisma.gym.findUnique({ where: { id: row.gymId }, select: { ownerId: true } }),
    membershipsFor(user?.id ?? null, [row.gymId]),
  ]);
  const viewer = viewerFor(user, gym?.ownerId ?? null, memberships.has(row.gymId));

  const subject = {
    authorId: row.authorId, gymId: row.gymId,
    visibility: row.visibility as Visibility, deletedAt: row.deletedAt,
  };
  // 404, not 403. A MEMBERS-only post must not confirm its own existence to a
  // stranger holding its id — the same no-existence-oracle rule DMs and claim
  // evidence already follow (CLAUDE.md rule 6).
  if (!canViewPost(subject, viewer)) return null;

  const tallies = await postTallies([row.id], user?.id ?? null);
  const [dto] = await hydratePage([mapPost(row, viewer, tallies)]);
  return dto;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface CreateInput {
  gymSlug: string;
  authorId: string;
  authorRole: string;
  body: string;
  /** Draft mention spans from the composer. Resolved to ids before storage. */
  entities?: unknown;
  visibility?: string | null;
  media?: unknown;
}

/**
 * Publish a post.
 *
 * Order is deliberate: authorise → moderate → validate media → write → attach.
 * Everything that can refuse the post runs before anything is persisted, so a
 * refusal leaves no half-made row and no reference taken against an asset that
 * was never used.
 */
export async function createPost(input: CreateInput): Promise<GymPostDTO> {
  const ctx = await gymContext(input.gymSlug, { id: input.authorId, role: input.authorRole });
  if (!ctx) throw notFound("No such gym.");

  if (!canCreatePost(ctx.viewer, ctx.gymMayPublish)) {
    throw forbidden(
      ctx.gymMayPublish
        ? "Join this gym to post on its feed."
        : "This gym isn't verified yet, so its feed is closed. Claim it and we'll review your evidence.",
    );
  }

  const body = (input.body ?? "").trim().slice(0, MAX_BODY_CHARS);
  const media = normaliseAttachments(input.media);
  if (!body && media.length === 0) throw new Error("Write something, or add a photo.");

  // The SAME moderation gate every text surface uses. Enforced in the service
  // layer for the reason lib/moderation/text states: routes multiply, this
  // function does not.
  if (body) await assertPublishable(body);
  await assertAttachable(media.map((m) => m.assetId));

  const visibility = isVisibility(input.visibility) ? input.visibility : "PUBLIC";

  // Resolved BEFORE the write and verified against the final text, exactly as
  // comments already do it — so what is stored is known-good and the notifier
  // below reads ids off it rather than re-parsing the body.
  const entities = await resolveDraftEntities(body, input.entities);

  const post = await prisma.gymPost.create({
    data: {
      gymId: ctx.gym.id, authorId: input.authorId, body, visibility,
      entities: entities.length ? (entities as unknown as Prisma.InputJsonValue) : undefined,
    },
    select: { id: true },
  });
  await attachMedia(post.id, media);

  // Only PUBLIC and MEMBERS posts ping the people they name. Mentioning someone
  // in a PRIVATE post would send them to a post only the author and the gym's
  // owner can open — a notification whose link 404s for its recipient.
  if (entities.length > 0 && visibility !== "PRIVATE") {
    await notifyPostMention({
      post: { id: post.id, authorId: input.authorId, gymSlug: ctx.gym.slug, gymName: ctx.gym.name },
      actorId: input.authorId,
      body,
      entities,
    });
  }

  const created = await getPost(post.id, { id: input.authorId, role: input.authorRole });
  if (!created) throw new Error("Could not publish that post.");
  return created;
}

export interface UpdateInput {
  id: string;
  userId: string;
  userRole: string;
  body?: string | null;
  /** Draft mention spans for the NEW body. Only read when the body changes. */
  entities?: unknown;
  visibility?: string | null;
  /** The FULL desired attachment set. Omitted leaves media untouched. */
  media?: unknown;
}

/**
 * Edit a post.
 *
 * Media is expressed as the desired FINAL set rather than add/remove verbs, and
 * the diff is computed here. That is what makes the reference arithmetic
 * survive a retry: replaying the same PATCH computes an empty diff and moves no
 * counts, where an "add these / drop those" API replayed twice would take two
 * references for one attachment.
 */
export async function updatePost(input: UpdateInput): Promise<GymPostDTO> {
  const existing = await prisma.gymPost.findUnique({
    where: { id: input.id },
    select: {
      id: true, gymId: true, authorId: true, visibility: true, deletedAt: true, body: true,
      gym: { select: { ownerId: true, slug: true, name: true } },
      media: { select: { assetId: true } },
    },
  });
  if (!existing || existing.deletedAt) throw notFound();

  const memberships = await membershipsFor(input.userId, [existing.gymId]);
  const viewer = viewerFor(
    { id: input.userId, role: input.userRole },
    existing.gym.ownerId,
    memberships.has(existing.gymId),
  );
  const subject = {
    authorId: existing.authorId, gymId: existing.gymId,
    visibility: existing.visibility as Visibility, deletedAt: existing.deletedAt,
  };
  // Read first, so a stranger probing ids gets "no such post" rather than
  // "you can't edit that", which would confirm it exists.
  if (!canViewPost(subject, viewer)) throw notFound();
  if (!canEditPost(subject, viewer)) throw forbidden("You can only edit your own posts.");

  const data: Prisma.GymPostUpdateInput = {};
  let touched = false;

  if (typeof input.body === "string") {
    const body = input.body.trim().slice(0, MAX_BODY_CHARS);
    if (body !== existing.body) {
      // Edit is the obvious way round a create-time check — post something
      // clean, then edit it into a slur. Gating create alone leaves it open.
      if (body) await assertPublishable(body);
      data.body = body;
      touched = true;

      // ── Entities are re-resolved against the NEW text, always ────────────
      // Offsets are absolute positions into the body. Leaving the old list in
      // place after an edit is not a stale hint, it is corruption: deleting one
      // character earlier in the sentence shifts every span, and the entity now
      // covers the wrong characters while still carrying a real user's id — a
      // link and a highlight over somebody else's words.
      //
      // So a body change always REPLACES the list. A client that edits without
      // sending entities clears them, which degrades the post to the legacy
      // parser rather than leaving spans pointing at text that moved.
      const resolved = await resolveDraftEntities(body, input.entities);
      data.entities = resolved.length
        ? (resolved as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
    }
  }
  if (isVisibility(input.visibility) && input.visibility !== existing.visibility) {
    data.visibility = input.visibility;
    touched = true;
  }

  let mediaChanged = false;
  if (input.media !== undefined) {
    const desired = normaliseAttachments(input.media);
    const desiredIds = desired.map((m) => m.assetId);
    const currentIds = existing.media.map((m) => m.assetId);
    const added = desired.filter((m) => !currentIds.includes(m.assetId));
    const removed = currentIds.filter((id) => !desiredIds.includes(id));

    if (added.length > 0) await assertAttachable(added.map((m) => m.assetId));
    if (removed.length > 0) await detachMedia(existing.id, removed);
    if (added.length > 0) await attachMedia(existing.id, added);
    mediaChanged = added.length > 0 || removed.length > 0;
  }

  const finalBody = typeof data.body === "string" ? data.body : existing.body;
  const stillHasMedia = await prisma.gymPostMedia.count({ where: { postId: existing.id } });
  if (!finalBody && stillHasMedia === 0) {
    throw new Error("A post needs text or a photo. Delete it instead.");
  }

  if (touched || mediaChanged) {
    // editedAt, not updatedAt. updatedAt moves whenever a counter does, so an
    // "edited" badge driven by it would appear the moment somebody else liked
    // the post.
    await prisma.gymPost.update({ where: { id: existing.id }, data: { ...data, editedAt: new Date() } });
  }

  // Someone added to the post by an edit is told, once. The emitter's dedupe key
  // is (post, recipient), so re-saving a post that already named them is a
  // no-op — which is what stops an edit loop from being a notification loop.
  const finalVisibility = (data.visibility as Visibility | undefined) ?? (existing.visibility as Visibility);
  if (Array.isArray(data.entities) && data.entities.length > 0 && finalVisibility !== "PRIVATE") {
    await notifyPostMention({
      post: {
        id: existing.id, authorId: existing.authorId,
        gymSlug: existing.gym.slug, gymName: existing.gym.name,
      },
      actorId: input.userId,
      body: finalBody,
      entities: data.entities as unknown as RichEntity[],
    });
  }

  const updated = await getPost(existing.id, { id: input.userId, role: input.userRole });
  if (!updated) throw notFound();
  return updated;
}

/**
 * Soft-delete a post and release its media.
 *
 * The claim is ATOMIC: updateMany filtered on `deletedAt: null` means exactly
 * one caller can win the transition, so two simultaneous deletes cannot both go
 * on to release the same references and drive a shared asset's count below what
 * other posts still hold. A check-then-write here would be a silent
 * double-release, which is the one failure mode that destroys another post's
 * images.
 */
export async function deletePost(input: {
  id: string;
  userId: string;
  userRole: string;
}): Promise<{ ok: true }> {
  const existing = await prisma.gymPost.findUnique({
    where: { id: input.id },
    select: {
      id: true, gymId: true, authorId: true, visibility: true, deletedAt: true,
      gym: { select: { ownerId: true } },
    },
  });
  if (!existing || existing.deletedAt) throw notFound();

  const memberships = await membershipsFor(input.userId, [existing.gymId]);
  const viewer = viewerFor(
    { id: input.userId, role: input.userRole },
    existing.gym.ownerId,
    memberships.has(existing.gymId),
  );
  const subject = {
    authorId: existing.authorId, gymId: existing.gymId,
    visibility: existing.visibility as Visibility, deletedAt: existing.deletedAt,
  };
  if (!canViewPost(subject, viewer)) throw notFound();
  if (!canDeletePost(subject, viewer)) throw forbidden("You can't delete that post.");

  const byAuthor = viewer.id === existing.authorId;
  const { count } = await prisma.gymPost.updateMany({
    where: { id: existing.id, deletedAt: null },
    data: {
      deletedAt: new Date(),
      deletedById: input.userId,
      // "author" vs "moderation" — same outcome for a reader, completely
      // different operational meaning. One is someone changing their mind, the
      // other is an enforcement action that has to be reviewable.
      deletedReason: byAuthor ? "author" : "moderation",
    },
  });
  // Lost the race: another caller already deleted it and is releasing the
  // references. Doing it again is the double-release above.
  if (count === 0) return { ok: true };

  await detachAllMedia(existing.id);
  return { ok: true };
}

// ─── Comments ───────────────────────────────────────────────────────────────

const COMMENT_INCLUDE = { author: { select: AUTHOR_SELECT } } satisfies Prisma.GymPostCommentInclude;
type CommentRow = Prisma.GymPostCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

function mapComment(row: CommentRow, viewer: Viewer, tallies: Tallies): GymPostCommentDTO {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    author: mapAuthor(row.author),
    // A removed comment renders as a tombstone rather than vanishing: dropping
    // it would tear the reply chain and leave replies answering nothing.
    body: deleted ? "" : row.body,
    // Raw here; hydrated for the whole page by the list query. A deleted
    // comment carries none — its body is gone, so a span over it would point
    // at characters that no longer exist.
    entities: deleted ? null : (row.entities ?? null),
    reactionCount: row.reactionCount,
    myReactions: tallies.mine.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deleted,
    canEdit: canEditComment({ authorId: row.authorId, deletedAt: row.deletedAt }, viewer),
    canDelete: canDeleteComment({ authorId: row.authorId, deletedAt: row.deletedAt }, viewer),
  };
}

/** Load a post and the viewer's standing on it — the preamble every comment
 *  and reaction operation needs, in one place so none of them can skip it. */
async function postAccess(postId: string, user: Principal | null) {
  const post = await prisma.gymPost.findUnique({
    where: { id: postId },
    select: {
      id: true, gymId: true, authorId: true, visibility: true, deletedAt: true,
      gym: { select: { ownerId: true, slug: true, name: true } },
    },
  });
  if (!post || post.deletedAt) return null;

  const memberships = await membershipsFor(user?.id ?? null, [post.gymId]);
  const viewer = viewerFor(user, post.gym.ownerId, memberships.has(post.gymId));
  const subject = {
    authorId: post.authorId, gymId: post.gymId,
    visibility: post.visibility as Visibility, deletedAt: post.deletedAt,
  };
  if (!canViewPost(subject, viewer)) return null;

  const ref: PostRef = {
    id: post.id, authorId: post.authorId, gymSlug: post.gym.slug, gymName: post.gym.name,
  };
  return { post, viewer, subject, ref };
}

export async function listComments(input: {
  postId: string;
  cursor?: string | null;
  limit?: number;
  user?: Principal | null;
}): Promise<Page<GymPostCommentDTO>> {
  const access = await postAccess(input.postId, input.user ?? null);
  if (!access) return { items: [], nextCursor: null };

  const limit = pageSize(input.limit, COMMENT_PAGE_SIZE, COMMENT_PAGE_MAX);
  const cursor = decodeCursor(input.cursor);
  // OLDEST first: a conversation reads top to bottom, and a reply that appears
  // above the thing it answers is unreadable.
  const rows = await prisma.gymPostComment.findMany({
    where: { postId: input.postId, ...seekWhere(cursor, "newer") },
    orderBy: seekOrderBy("newer"),
    take: limit + 1,
    include: COMMENT_INCLUDE,
  });

  const { items, nextCursor } = takePage(rows, limit);
  const tallies = await commentTallies(items.map((c) => c.id), input.user?.id ?? null);
  // ── Hydrate the whole PAGE in one query ─────────────────────────────────
  // Mention handles are refreshed against the user table here, which is what
  // makes a rename apply to every historical comment at once. Batched: per-row
  // hydration would be one round trip per comment.
  const mapped = items.map((c) => mapComment(c, access.viewer, tallies));
  const hydrated = await hydrateEntities(mapped.map((m) => ({ text: m.body, entities: m.entities })));
  mapped.forEach((m, i) => { m.entities = hydrated[i].length ? hydrated[i] : null; });
  return { items: mapped, nextCursor };
}

export async function addComment(input: {
  postId: string;
  authorId: string;
  authorRole: string;
  body: string;
  /** Draft mention spans from the composer. Resolved to ids before storage. */
  entities?: unknown;
  parentId?: string | null;
}): Promise<GymPostCommentDTO> {
  const user = { id: input.authorId, role: input.authorRole };
  const access = await postAccess(input.postId, user);
  if (!access) throw notFound();
  if (!canInteract(access.subject, access.viewer)) throw forbidden("You can't comment on that post.");

  const body = (input.body ?? "").trim().slice(0, MAX_COMMENT_CHARS);
  if (!body) throw new Error("Write something first.");
  await assertPublishable(body);

  // One level of nesting. A parent from a DIFFERENT post is silently flattened
  // to a top-level comment rather than accepted — accepting it would splice a
  // reply chain across two posts, and erroring on it would tell the caller
  // whether an id they guessed exists.
  let parentId: string | null = null;
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const parent = await prisma.gymPostComment.findFirst({
      where: { id: input.parentId, postId: input.postId, deletedAt: null },
      select: { id: true, parentId: true, authorId: true },
    });
    if (parent) {
      // Replying to a reply attaches to its PARENT, keeping the thread two
      // levels deep however deep the UI lets someone click.
      parentId = parent.parentId ?? parent.id;
      parentAuthorId = parent.authorId;
    }
  }

  // Resolved BEFORE the write: verified against the final text and the user
  // table, so what is stored is already known-good and the notifier below can
  // read ids straight off it.
  const entities = await resolveDraftEntities(body, input.entities);

  const comment = await prisma.gymPostComment.create({
    data: {
      postId: input.postId, authorId: input.authorId, body, parentId,
      entities: entities.length ? (entities as unknown as Prisma.InputJsonValue) : undefined,
    },
    include: COMMENT_INCLUDE,
  });
  await recountComments(input.postId);

  await notifyPostComment({
    post: access.ref, actorId: input.authorId, body, entities, parentAuthorId,
  });

  return mapComment(comment, access.viewer, { counts: new Map(), mine: new Map() });
}

export async function editComment(input: {
  commentId: string;
  userId: string;
  userRole: string;
  body: string;
}): Promise<GymPostCommentDTO> {
  const existing = await prisma.gymPostComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, postId: true, authorId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) throw notFound("That comment no longer exists.");

  const access = await postAccess(existing.postId, { id: input.userId, role: input.userRole });
  if (!access) throw notFound("That comment no longer exists.");
  if (!canEditComment({ authorId: existing.authorId, deletedAt: existing.deletedAt }, access.viewer)) {
    throw forbidden("You can only edit your own comments.");
  }

  const body = (input.body ?? "").trim().slice(0, MAX_COMMENT_CHARS);
  if (!body) throw new Error("Write something first.");
  await assertPublishable(body);

  const updated = await prisma.gymPostComment.update({
    where: { id: existing.id },
    data: { body, editedAt: new Date() },
    include: COMMENT_INCLUDE,
  });
  const tallies = await commentTallies([updated.id], input.userId);
  return mapComment(updated, access.viewer, tallies);
}

export async function deleteComment(input: {
  commentId: string;
  userId: string;
  userRole: string;
}): Promise<{ ok: true }> {
  const existing = await prisma.gymPostComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, postId: true, authorId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) throw notFound("That comment no longer exists.");

  const access = await postAccess(existing.postId, { id: input.userId, role: input.userRole });
  if (!access) throw notFound("That comment no longer exists.");
  if (!canDeleteComment({ authorId: existing.authorId, deletedAt: existing.deletedAt }, access.viewer)) {
    throw forbidden("You can't delete that comment.");
  }

  const byAuthor = access.viewer.id === existing.authorId;
  await prisma.gymPostComment.updateMany({
    where: { id: existing.id, deletedAt: null },
    data: { deletedAt: new Date(), deletedReason: byAuthor ? "author" : "moderation" },
  });
  await recountComments(existing.postId);
  return { ok: true };
}

/**
 * Recompute, never increment.
 *
 * ForumThread.reactionCount learnt this the expensive way: under concurrent
 * writes an increment/decrement pair drifts permanently, and this number feeds
 * the RANKER — so drift here does not just look wrong, it silently distorts
 * what the feed promotes.
 */
async function recountComments(postId: string): Promise<void> {
  const commentCount = await prisma.gymPostComment.count({ where: { postId, deletedAt: null } });
  await prisma.gymPost.update({ where: { id: postId }, data: { commentCount } }).catch(() => {});
}

// ─── Reactions ──────────────────────────────────────────────────────────────

export interface ReactionResult {
  reactions: Record<string, number>;
  myReactions: ReactionType[];
  reactionCount: number;
  reacted: boolean;
}

/**
 * Toggle a reaction on a post.
 *
 * Conflict-TOLERANT, exactly like the forum's: reacting is the highest-frequency
 * write in a feed, and a read-then-write toggle is a check-then-act race that
 * produced real 400s in the forum under eight concurrent taps. deleteMany
 * cannot throw, and a lost create race means the row the caller wanted already
 * exists — which is the outcome they asked for.
 */
export async function reactToPost(input: {
  postId: string;
  userId: string;
  userRole: string;
  type?: string;
}): Promise<ReactionResult> {
  const type: ReactionType = isReactionType(input.type) ? input.type : "like";
  const access = await postAccess(input.postId, { id: input.userId, role: input.userRole });
  if (!access) throw notFound();
  if (!canInteract(access.subject, access.viewer)) throw forbidden("You can't react to that post.");

  const existing = await prisma.gymPostReaction.findUnique({
    where: { postId_userId_type: { postId: input.postId, userId: input.userId, type } },
    select: { id: true },
  });

  let reacted: boolean;
  if (existing) {
    await prisma.gymPostReaction.deleteMany({
      where: { postId: input.postId, userId: input.userId, type },
    });
    reacted = false;
  } else {
    try {
      await prisma.gymPostReaction.create({ data: { postId: input.postId, userId: input.userId, type } });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    reacted = true;
    await notifyPostReaction({ post: access.ref, actorId: input.userId, type });
  }

  const reactionCount = await prisma.gymPostReaction.count({ where: { postId: input.postId } });
  await prisma.gymPost.update({ where: { id: input.postId }, data: { reactionCount } }).catch(() => {});

  const tallies = await postTallies([input.postId], input.userId);
  return {
    reactions: tallies.counts.get(input.postId) ?? {},
    myReactions: tallies.mine.get(input.postId) ?? [],
    reactionCount,
    reacted,
  };
}

export async function reactToComment(input: {
  commentId: string;
  userId: string;
  userRole: string;
  type?: string;
}): Promise<ReactionResult> {
  const type: ReactionType = isReactionType(input.type) ? input.type : "like";
  const comment = await prisma.gymPostComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, postId: true, authorId: true, deletedAt: true },
  });
  if (!comment || comment.deletedAt) throw notFound("That comment no longer exists.");

  const access = await postAccess(comment.postId, { id: input.userId, role: input.userRole });
  if (!access) throw notFound("That comment no longer exists.");
  if (!canInteract(access.subject, access.viewer)) throw forbidden("You can't react to that comment.");

  const existing = await prisma.gymPostCommentReaction.findUnique({
    where: { commentId_userId_type: { commentId: comment.id, userId: input.userId, type } },
    select: { id: true },
  });

  let reacted: boolean;
  if (existing) {
    await prisma.gymPostCommentReaction.deleteMany({
      where: { commentId: comment.id, userId: input.userId, type },
    });
    reacted = false;
  } else {
    try {
      await prisma.gymPostCommentReaction.create({
        data: { commentId: comment.id, userId: input.userId, type },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    reacted = true;
    await notifyCommentReaction({
      post: access.ref, commentId: comment.id, commentAuthorId: comment.authorId,
      actorId: input.userId, type,
    });
  }

  const reactionCount = await prisma.gymPostCommentReaction.count({ where: { commentId: comment.id } });
  await prisma.gymPostComment.update({ where: { id: comment.id }, data: { reactionCount } }).catch(() => {});

  const tallies = await commentTallies([comment.id], input.userId);
  return {
    reactions: tallies.counts.get(comment.id) ?? {},
    myReactions: tallies.mine.get(comment.id) ?? [],
    reactionCount,
    reacted,
  };
}

// ─── Share ──────────────────────────────────────────────────────────────────

/**
 * Record a share.
 *
 * Anonymous is allowed — sharing should not require an account — which is
 * exactly why the ROUTE rate-limits it per IP: shareCount is the heaviest input
 * to the ranker, so an unbounded anonymous increment is a one-line script for
 * putting any post at the top of the feed. Same lesson as ForumThread's
 * threadShare limit.
 *
 * Only PUBLIC posts are shareable. Handing out a share link to a MEMBERS-only
 * post would be an invitation to leak it, and the count would advertise that
 * something private exists.
 */
export async function sharePost(input: {
  postId: string;
  user?: Principal | null;
}): Promise<{ shareCount: number }> {
  const access = await postAccess(input.postId, input.user ?? null);
  if (!access) throw notFound();
  if (access.subject.visibility !== "PUBLIC") throw forbidden("That post isn't shareable.");

  const updated = await prisma.gymPost.update({
    where: { id: input.postId },
    data: { shareCount: { increment: 1 } },
    select: { shareCount: true },
  });
  await notifyPostShare({ post: access.ref, actorId: input.user?.id ?? null });
  return { shareCount: updated.shareCount };
}

// ─── Moderation surface ─────────────────────────────────────────────────────

/**
 * Resolve reported gym posts for the moderation queue.
 *
 * Exported for lib/moderation/reports, which owns the queue. Gym posts join the
 * EXISTING queue rather than getting a second one: same ForumReport table, same
 * moderator habits, same audit trail.
 */
export async function resolveReportedPosts(ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.gymPost.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, body: true, deletedAt: true,
      gym: { select: { slug: true } },
      author: { select: { name: true, username: true } },
    },
  });
}

/** Hide or restore a gym post from the moderation console. */
export async function setPostHidden(input: {
  postId: string;
  moderatorId: string;
  hidden: boolean;
}): Promise<boolean> {
  if (input.hidden) {
    const { count } = await prisma.gymPost.updateMany({
      where: { id: input.postId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: input.moderatorId, deletedReason: "moderation" },
    });
    if (count === 0) return false;
    await detachAllMedia(input.postId);
    return true;
  }
  // Restoring returns the words. It does NOT re-attach the media: those
  // references were released on removal and the assets may already have been
  // swept, so silently re-pointing at them would resurrect either nothing or
  // somebody else's bytes. An operator restoring a post gets the post back and
  // the author re-adds the photos.
  const { count } = await prisma.gymPost.updateMany({
    where: { id: input.postId, deletedAt: { not: null } },
    data: { deletedAt: null, deletedById: null, deletedReason: null },
  });
  return count > 0;
}
