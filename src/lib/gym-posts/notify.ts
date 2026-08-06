import "server-only";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications-store";
import { publicDisplayName } from "@/lib/display-name";
import { extractMentions } from "@/lib/mentions";

// ════════════════════════════════════════════════════════════════════════════
//  GYM POST NOTIFICATIONS — emitters only. There is no engine in this file.
//
//  Every function here ends in notify(), the one user-targeted notification
//  engine. No new table, no second delivery path, no separate push call: the
//  stored row, the dedupe key, the category preference and the push are all
//  already solved in lib/notifications-store and lib/push. What was missing was
//  something to SAY, and that is all this adds.
//
//  ── Two rules carried over from the forum, because they were learnt there ──
//  1. ONE notification per action. Someone who is mentioned in a reply to their
//     own post under a comment they wrote gets a single, most-specific ping.
//     Three pings for one comment is how a feed gets muted.
//  2. Best-effort, always. The comment is already saved. A notification hiccup
//     must never fail the write that triggered it.
//
//  ── Why reactions are deduped and replies are not ─────────────────────────
//  A reply is a new thing said and deserves telling every time. A reaction is a
//  toggle: without a dedupe key, un-reacting and re-reacting is a one-line
//  script for buzzing someone's phone indefinitely. `(userId, dedupeKey)` is
//  unique, so the second one is silently a no-op — and notify() returns early
//  on a skipped insert, so it does not push either. That is the same reasoning
//  the FOLLOW notification already relies on.
// ════════════════════════════════════════════════════════════════════════════

export interface PostRef {
  id: string;
  authorId: string;
  gymSlug: string;
  gymName: string;
}

/** Where a notification about this post should land the reader. */
const postUrl = (p: PostRef) => `/gyms/${p.gymSlug}?post=${p.id}`;

const excerpt = (s: string, n = 120) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Someone commented. Tell the people it is actually aimed at.
 *
 * Targets in order of specificity, deduped into a Map so the most-directed
 * wording wins and nobody is told twice:
 *   mentioned by name  →  replied to directly  →  wrote the post
 */
export async function notifyPostComment(input: {
  post: PostRef;
  actorId: string;
  body: string;
  /** The comment being replied to, when this is a reply. */
  parentAuthorId?: string | null;
}): Promise<void> {
  try {
    const actor = await prisma.user.findUnique({
      where: { id: input.actorId },
      select: { name: true, username: true },
    });
    const who = actor ? publicDisplayName(actor) : "Someone";
    const url = postUrl(input.post);
    const body = `${input.post.gymName} — ${excerpt(input.body)}`;

    const targets = new Map<string, { title: string; icon: string }>();

    // @mentions. Usernames are stored lower-case but people type them however
    // they like, so extractMentions lowers them — matching on the raw text
    // would silently drop "@KaylaBrooks".
    const named = extractMentions(input.body);
    if (named.length > 0) {
      const mentioned = await prisma.user.findMany({
        where: { username: { in: named } },
        select: { id: true },
      });
      for (const u of mentioned) {
        if (u.id !== input.actorId) targets.set(u.id, { title: `${who} mentioned you`, icon: "mention" });
      }
    }

    if (input.parentAuthorId && input.parentAuthorId !== input.actorId && !targets.has(input.parentAuthorId)) {
      targets.set(input.parentAuthorId, { title: `${who} replied to you`, icon: "reply" });
    }
    if (input.post.authorId !== input.actorId && !targets.has(input.post.authorId)) {
      targets.set(input.post.authorId, { title: `${who} commented on your post`, icon: "reply" });
    }
    if (targets.size === 0) return;

    await Promise.all(
      [...targets].map(([userId, t]) =>
        notify(prisma, userId, {
          type: "GYM_POST_REPLY",
          title: t.title,
          body,
          url,
          icon: t.icon,
          // Collapses on the DEVICE: a busy thread lights the phone once while
          // every row still lands in the in-app list.
          tag: `gym-post:${input.post.id}`,
        }),
      ),
    );
  } catch {
    // Swallowed on purpose — see the header.
  }
}

/** Someone reacted to a post. Once per person per post, ever. */
export async function notifyPostReaction(input: {
  post: PostRef;
  actorId: string;
  type: string;
}): Promise<void> {
  if (input.post.authorId === input.actorId) return;
  try {
    const actor = await prisma.user.findUnique({
      where: { id: input.actorId },
      select: { name: true, username: true },
    });
    await notify(prisma, input.post.authorId, {
      type: "GYM_POST_REACTION",
      title: `${actor ? publicDisplayName(actor) : "Someone"} reacted to your post`,
      body: input.post.gymName,
      url: postUrl(input.post),
      // The icon is a semantic KEY from lib/notification-icons, not the
      // reaction's name. Passing `input.type` here compiled fine and resolved
      // to a generic bell in the list, because "fire" and "respect" are not
      // icon keys — the exact silent-fallback class of bug the key registry's
      // source-walking test exists to catch. It could not catch this one: the
      // value was a variable, not a literal.
      icon: "reaction",
      dedupeKey: `gym_post_react:${input.post.id}:${input.actorId}`,
      tag: `gym-post:${input.post.id}`,
    });
  } catch { /* non-fatal */ }
}

/** Someone reacted to a comment. Same dedupe rule, scoped to the comment. */
export async function notifyCommentReaction(input: {
  post: PostRef;
  commentId: string;
  commentAuthorId: string;
  actorId: string;
  type: string;
}): Promise<void> {
  if (input.commentAuthorId === input.actorId) return;
  try {
    const actor = await prisma.user.findUnique({
      where: { id: input.actorId },
      select: { name: true, username: true },
    });
    await notify(prisma, input.commentAuthorId, {
      type: "GYM_POST_REACTION",
      title: `${actor ? publicDisplayName(actor) : "Someone"} reacted to your comment`,
      body: input.post.gymName,
      url: postUrl(input.post),
      // The icon is a semantic KEY from lib/notification-icons, not the
      // reaction's name. Passing `input.type` here compiled fine and resolved
      // to a generic bell in the list, because "fire" and "respect" are not
      // icon keys — the exact silent-fallback class of bug the key registry's
      // source-walking test exists to catch. It could not catch this one: the
      // value was a variable, not a literal.
      icon: "reaction",
      dedupeKey: `gym_comment_react:${input.commentId}:${input.actorId}`,
      tag: `gym-post:${input.post.id}`,
    });
  } catch { /* non-fatal */ }
}

/**
 * Someone shared a post.
 *
 * Sharing is allowed anonymously (sharing should not require an account), and
 * an anonymous share notifies nobody — "someone, somewhere shared this" is not
 * information, and counting it is what shareCount is for.
 */
export async function notifyPostShare(input: {
  post: PostRef;
  actorId: string | null;
}): Promise<void> {
  if (!input.actorId || input.post.authorId === input.actorId) return;
  try {
    const actor = await prisma.user.findUnique({
      where: { id: input.actorId },
      select: { name: true, username: true },
    });
    await notify(prisma, input.post.authorId, {
      type: "GYM_POST_SHARE",
      title: `${actor ? publicDisplayName(actor) : "Someone"} shared your post`,
      body: input.post.gymName,
      url: postUrl(input.post),
      icon: "share",
      dedupeKey: `gym_post_share:${input.post.id}:${input.actorId}`,
      tag: `gym-post:${input.post.id}`,
    });
  } catch { /* non-fatal */ }
}
