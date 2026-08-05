import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  ANONYMISING A DELETED USER'S DISCUSSION.
//
//  ── The bug this exists to fix ────────────────────────────────────────────
//  ForumThread.author and ForumPost.author are both `onDelete: Cascade`. So
//  deleting an account did not just remove that person's posts — deleting a
//  THREAD they had started cascaded to every post inside it, including replies
//  written by other people. One member exercising their right to erasure
//  silently destroyed other members' contributions and left the conversations
//  that quoted them full of holes.
//
//  That is both a data-integrity problem and a fairness one: your right to erase
//  yourself does not extend to erasing what someone else wrote.
//
//  ── The fix ───────────────────────────────────────────────────────────────
//  Re-point the departing user's threads and posts at a single reserved
//  tombstone account before the delete runs. The discussion survives, attributed
//  to "Deleted User"; the person does not. This is the "anonymise where hard
//  deletion would break referential integrity" case, and it is the ONLY content
//  that gets it — picks, follows, notifications, reactions and reviews all still
//  cascade away, because nothing structural depends on them.
//
//  ── What the tombstone is NOT ─────────────────────────────────────────────
//  Not a real account: no email, no password hash, no session can ever be
//  issued for it, and `deletedTombstone` marks it so no future feature mistakes
//  it for a member. It exists only to satisfy the foreign key.
// ════════════════════════════════════════════════════════════════════════════

/** The reserved handle. Taken out of the namespace by the unique constraint. */
export const TOMBSTONE_USERNAME = "deleted";
const TOMBSTONE_NAME = "Deleted User";

/**
 * The shared tombstone account, created on first use.
 *
 * `upsert` on the unique username rather than find-then-create: two accounts
 * deleted concurrently would otherwise race into a P2002 that fails one of the
 * deletions (CLAUDE.md rule 4).
 */
export async function getTombstoneUser(): Promise<{ id: string }> {
  return prisma.user.upsert({
    where: { username: TOMBSTONE_USERNAME },
    update: {},
    create: {
      username: TOMBSTONE_USERNAME,
      name: TOMBSTONE_NAME,
      // No email and no passwordHash — both nullable, and both absent on purpose.
      // There is no credential that could ever authenticate as this row.
      email: null,
      passwordHash: null,
    },
    select: { id: true },
  });
}

export interface AnonymiseResult {
  threads: number;
  posts: number;
  quotes: number;
}

/**
 * Re-point everything structural the user authored at the tombstone.
 *
 * Called immediately BEFORE `prisma.user.delete()`. Order matters: once the row
 * is gone the cascade has already taken the posts with it and there is nothing
 * left to reassign.
 *
 * Reactions, bookmarks and subscriptions are deliberately NOT reassigned — they
 * are personal signals rather than content, they carry per-user unique
 * constraints that a bulk re-point would collide on, and a conversation reads
 * exactly the same without them.
 */
export async function anonymiseAuthoredContent(userId: string): Promise<AnonymiseResult> {
  const tombstone = await getTombstoneUser();
  if (tombstone.id === userId) return { threads: 0, posts: 0, quotes: 0 };

  // Collected BEFORE the transaction, and this ordering is load-bearing: the
  // transaction re-points these same posts at the tombstone, so asking "which
  // posts did they write?" afterwards would return nothing and the quote
  // snapshots would keep their name forever.
  const authored = await prisma.forumPost.findMany({
    where: { authorId: userId },
    select: { id: true },
  });
  const authoredIds = authored.map((r) => r.id);

  const [threads, posts, quotes] = await prisma.$transaction([
    prisma.forumThread.updateMany({ where: { authorId: userId }, data: { authorId: tombstone.id } }),
    prisma.forumPost.updateMany({ where: { authorId: userId }, data: { authorId: tombstone.id } }),
    // The quote snapshot denormalises the quoted author's DISPLAY NAME onto the
    // quoting post, so the departing user's name would survive inside other
    // people's replies even after every row of theirs was reassigned. Scrubbed
    // by the id of the post being quoted, which is the only reliable link.
    prisma.forumPost.updateMany({
      where: { quotedId: { in: authoredIds } },
      data: { quotedAuthor: TOMBSTONE_NAME },
    }),
  ]);

  return { threads: threads.count, posts: posts.count, quotes: quotes.count };
}
