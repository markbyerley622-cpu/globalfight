// ════════════════════════════════════════════════════════════════════════════
//  The wire shape of a gym post, and the constants every layer shares.
//
//  Client-safe: no prisma, no server-only, no env. The composer, the feed and
//  the API all import from here, so a limit the client enforces for a fast
//  error message is literally the same number the server refuses on.
// ════════════════════════════════════════════════════════════════════════════

/** Reaction vocabulary. Same shape as the forum's, so nothing new is learnt. */
export const REACTION_TYPES = ["like", "fire", "respect", "laugh"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const isReactionType = (v: unknown): v is ReactionType =>
  typeof v === "string" && (REACTION_TYPES as readonly string[]).includes(v);

export const VISIBILITIES = ["PUBLIC", "MEMBERS", "PRIVATE"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const isVisibility = (v: unknown): v is Visibility =>
  typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);

/** Enough for a carousel; small enough that one post is not an album dump. */
export const MAX_MEDIA_PER_POST = 10;
export const MAX_BODY_CHARS = 5_000;
export const MAX_COMMENT_CHARS = 2_000;
export const MAX_ALT_CHARS = 200;
export const MAX_CAPTION_CHARS = 160;

/** Page sizes. The ceiling matters: it is what a client cannot talk us past. */
export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_MAX = 50;
export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_PAGE_MAX = 100;

/**
 * One rendered image.
 *
 * Note what is NOT here: no key, no bucket, no filename, no mime. The client is
 * handed URLs that were minted server-side from a PUBLIC key and nothing it
 * could use to address storage directly.
 */
export interface PostMediaDTO {
  id: string;
  /** Full-size, aspect-preserved. */
  url: string;
  /** Lazy-load thumbnail. */
  thumbUrl: string;
  /** Intrinsic size, so the layout reserves the box before the image lands. */
  width: number;
  height: number;
  alt: string | null;
  caption: string | null;
  /** Tiny LQIP, when the processor produced one. */
  blurhash: string | null;
}

export interface PostAuthorDTO {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  /** Self-declared label. Drives a chip, NEVER a permission. */
  registryRole: string;
}

export interface GymRefDTO {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  verified: boolean;
}

export interface GymPostDTO {
  id: string;
  gym: GymRefDTO;
  author: PostAuthorDTO;
  body: string;
  visibility: Visibility;
  pinned: boolean;
  media: PostMediaDTO[];
  commentCount: number;
  reactionCount: number;
  /** Structured mentions, hints refreshed on read. Null on legacy content. */
  entities?: unknown;
  shareCount: number;
  /** type → count, for every type anyone has used on this post. */
  reactions: Record<string, number>;
  /** Which of those the VIEWER has used. Empty for anonymous. */
  myReactions: ReactionType[];
  createdAt: string;
  editedAt: string | null;
  /** What the viewer may do. Computed server-side; the UI never re-derives it. */
  canEdit: boolean;
  canDelete: boolean;
}

export interface GymPostCommentDTO {
  id: string;
  postId: string;
  parentId: string | null;
  author: PostAuthorDTO;
  body: string;
  /**
   * Structured mentions, hints refreshed on read.
   *
   * Null on legacy content — EntityText falls back to the parser, so every
   * comment written before this existed keeps rendering with no backfill.
   */
  entities?: unknown;
  reactionCount: number;
  myReactions: ReactionType[];
  createdAt: string;
  editedAt: string | null;
  /** A removed comment still renders as a tombstone so the reply chain holds. */
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** Every paginated read in this domain answers in exactly this shape. */
export interface Page<T> {
  items: T[];
  /** Opaque. Feed it back verbatim; never parse it on the client. */
  nextCursor: string | null;
}
