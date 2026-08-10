import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";

// ════════════════════════════════════════════════════════════════════════════
//  BLOCKING — the service layer. Every enforcement decision lives here.
//
//  ── Why this exists ──────────────────────────────────────────────────────
//  Google Play's User Generated Content policy requires an app where users
//  interact to provide an in-app system for reporting and BLOCKING both content
//  and users. Reporting already existed (ForumReport + the moderator queue);
//  blocking did not, and direct messages are shipped — so anyone could open a
//  thread with anyone and the recipient's only recourse was to report a message
//  that had already arrived. That is a submission blocker, not a nice-to-have.
//
//  ── The one rule everything else follows ─────────────────────────────────
//  A block is STORED one-directionally (who pressed the button) and ENFORCED
//  symmetrically. `blockExistsBetween` is the only predicate any caller should
//  use, and it looks both ways. Storing it directionally is what lets the
//  blocker see their own list and unblock; enforcing it symmetrically is what
//  stops the blocked party simply doing the thing from their side.
//
//  ── What a block deliberately does NOT do ────────────────────────────────
//  It does not notify the blocked person, does not appear on their profile, and
//  is never counted in any public number. A block that announces itself is an
//  escalation vector aimed at the person who used it, and the harassment case
//  this feature exists for is exactly the one where that matters most.
//
//  It also does not retract published content. Hiding a blocked author's posts
//  is done at the READ, per viewer (`blockedIdsFor`), so the thread other people
//  are reading is untouched — a block is a personal filter, not a moderation
//  action. Moderation is lib/moderation/reports.ts and stays separate.
// ════════════════════════════════════════════════════════════════════════════

export interface BlockedPerson {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  blockedAt: string;
}

/**
 * Is either of these two blocking the other?
 *
 * THE predicate. Both directions, one query. Callers must not re-derive this
 * with a single-direction lookup — see the header.
 */
export async function blockExistsBetween(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Every user id the viewer should not see content from — both people they
 * blocked and people who blocked them.
 *
 * Returned as a plain array so it drops straight into a Prisma
 * `authorId: { notIn: … }`. Empty array is the common case and callers should
 * skip the filter entirely when it is empty rather than emit `notIn: []`.
 */
export async function blockedIdsFor(viewerId: string | null | undefined): Promise<string[]> {
  if (!viewerId) return [];
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  if (rows.length === 0) return [];
  const ids = new Set<string>();
  for (const r of rows) ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  return [...ids];
}

/** Only the blocks the viewer MADE — what the settings screen can undo. */
export async function listBlocked(viewerId: string): Promise<BlockedPerson[]> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: viewerId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      blocked: { select: { id: true, name: true, username: true, image: true } },
    },
  });
  return rows.map((r) => ({
    id: r.blocked.id,
    // Never the raw `name` — see lib/display-name.
    name: publicDisplayName(r.blocked),
    username: r.blocked.username,
    image: r.blocked.image,
    blockedAt: r.createdAt.toISOString(),
  }));
}

/** Has the viewer blocked this specific person? Drives the button's state. */
export async function hasBlocked(viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return false;
  const row = await prisma.userBlock.findUnique({
    where: { blockerId_blockedId: { blockerId: viewerId, blockedId: targetId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Block someone.
 *
 * `createMany({ skipDuplicates })` per CLAUDE.md rule 4: a double-tap or a
 * second tab must not race the unique index into a P2002 that both fails the
 * write and leaks the constraint name to the client. Blocking is idempotent by
 * definition — pressing it twice means the same thing as pressing it once.
 *
 * SEVERS THE FOLLOW GRAPH IN BOTH DIRECTIONS. Leaving the follows in place
 * would keep pushing the blocked person's activity into the blocker's feed and
 * keep notifying them about the blocker's, which is the harassment channel this
 * is meant to close, only slower.
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error("You can't block yourself.");

  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) throw new Error("That person no longer exists.");

  await prisma.$transaction([
    prisma.userBlock.createMany({
      data: [{ blockerId, blockedId }],
      skipDuplicates: true,
    }),
    prisma.userFollow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      },
    }),
  ]);
}

/**
 * Unblock.
 *
 * `deleteMany`, not `delete`: unblocking something already unblocked (a retry,
 * a stale settings screen) must affect zero rows, not throw a P2025 that would
 * reach the client naming the model — CLAUDE.md rules 4 and 5.
 *
 * Follows are NOT restored. They were a positive act that the block ended; the
 * only person who can decide to follow again is the user, by following again.
 */
export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
}
