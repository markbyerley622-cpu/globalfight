// Shared forum DTOs (client + server safe — no server-only imports here).
// The Prisma repo returns these plain shapes so client components can consume
// them directly over fetch/SSE.

import type { ForumAttachment } from "@/lib/forum/embeds";
export type { ForumAttachment };

// The four supported reaction types (Phase 3). `like` stays first/default so it
// remains backward compatible with the original single-reaction model.
// Combat Register reactions: Respect (closed fist) and Disrespect (middle
// finger). Rendered as custom SVG emblems (see components/forums/emblems.tsx),
// not emoji. `emoji` is kept only as a non-visual fallback.
export const REACTION_TYPES = ["respect", "disrespect"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_META: Record<ReactionType, { label: string; emoji: string }> = {
  respect: { label: "Respect", emoji: "🤝" },
  disrespect: { label: "Disrespect", emoji: "🖕" },
};

export interface ForumCategoryDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  order: number;
  threadCount?: number;
}

export interface ForumThreadDTO {
  id: string;
  slug: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  authorName: string;
  authorId: string;
  authorRole: string;          // registry role: fan | fighter | world_champion | …
  authorAppRole: string;       // app role: USER | MODERATOR | ADMIN (for staff crown)
  authorSport: string | null;  // sport when the author has a fighter profile
  authorImage: string | null;  // profile photo (Phase 5 identity)
  kind: string;                // discussion | fighter_post | promoter_post | announcement
  pinned: boolean;
  locked: boolean;
  views: number;
  replyCount: number;
  shareCount: number;
  reactionCount: number;
  lastPostAt: string;
  createdAt: string;
  // Viewer-specific flags (only set when a viewer is known).
  bookmarked?: boolean;
  following?: boolean;
  // Preview of the opening post (feed cards): excerpt + first image.
  excerpt?: string | null;
  previewImage?: string | null;
}

export interface ForumPostDTO {
  id: string;
  threadId: string;
  content: string;
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  authorImage: string | null;  // profile photo (Phase 5 identity)
  authorRole: string;        // registry role: fan | fighter | world_champion | …
  authorAppRole: string;     // app role: USER | MODERATOR | ADMIN (for staff crown)
  authorSport: string | null; // sport value when the author has a fighter profile
  authorReputation: number;
  parentId: string | null;
  attachments: ForumAttachment[];
  // Quoted reply (Phase 4): snapshot of the post this one quotes.
  quote: { id: string | null; author: string; excerpt: string } | null;
  edited: boolean;
  deleted: boolean;
  likeCount: number;          // legacy "like" count (kept for back-compat)
  reactedByMe: boolean;       // viewer liked (legacy single-reaction flag)
  // Per-type reaction counts + which types the viewer has reacted with.
  reactions: Record<string, number>;
  myReactions: string[];
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// Realtime event shape (shared by the SSE server route and the client hook).
export type ForumEvent =
  | { type: "thread:new"; categorySlug: string; threadSlug: string; title: string }
  | { type: "thread:delete"; categorySlug: string; threadSlug: string }
  | { type: "post:new"; threadSlug: string; postId: string }
  | { type: "post:edit"; threadSlug: string; postId: string }
  | { type: "post:delete"; threadSlug: string; postId: string }
  | { type: "post:react"; threadSlug: string; postId: string };

export const FORUM_EVENT_TYPES = [
  "thread:new", "thread:delete", "post:new", "post:edit", "post:delete", "post:react",
] as const;

// The canonical forum categories, seeded into Postgres (idempotent).
// `icon` is the community slug — <CategoryIcon> resolves it to a bespoke Combat
// Reviews community glyph (see components/icons/community-icons.tsx), falling
// back to the lucide news/forum map for any non-community category.
export const FORUM_CATEGORY_SEED: {
  name: string; slug: string; description: string; icon: string; order: number;
}[] = [
  { name: "MMA", slug: "mma", description: "Mixed martial arts — UFC, PFL, ONE, regional.", icon: "mma", order: 1 },
  { name: "Boxing", slug: "boxing", description: "The sweet science across every division.", icon: "boxing", order: 2 },
  { name: "Muay Thai", slug: "muay-thai", description: "The art of eight limbs.", icon: "muay-thai", order: 3 },
  { name: "Kickboxing", slug: "kickboxing", description: "GLORY, full-contact and beyond.", icon: "kickboxing", order: 4 },
  { name: "Bare Knuckle", slug: "bare-knuckle", description: "BKFC and bare-knuckle promotions.", icon: "bare-knuckle", order: 6 },
  { name: "BJJ", slug: "bjj", description: "Gi and no-gi grappling.", icon: "bjj", order: 7 },
  { name: "Wrestling", slug: "wrestling", description: "Folkstyle, freestyle and Greco-Roman.", icon: "wrestling", order: 8 },
  { name: "Judo", slug: "judo", description: "The gentle way.", icon: "judo", order: 9 },
  { name: "Taekwondo", slug: "taekwondo", description: "WT and ITF.", icon: "taekwondo", order: 10 },
  { name: "Sambo", slug: "sambo", description: "Sport and combat sambo.", icon: "sambo", order: 11 },
  { name: "General Discussion", slug: "general", description: "Everything combat sports.", icon: "general", order: 12 },
  { name: "Industry Discussion", slug: "industry", description: "Promoters, officials, gyms and the business.", icon: "industry", order: 13 },
];
