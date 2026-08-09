import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertPublishable } from "@/lib/moderation/text";
import { notify } from "@/lib/notifications-store";
import {
  CATEGORIES, STATUSES, isCategory, isStatus, TITLE_MAX, BODY_MAX, TITLE_MIN, BODY_MIN,
  type FeedbackCategory, type FeedbackStatus,
} from "./shared";

// ════════════════════════════════════════════════════════════════════════════
//  The public feedback board — every decision, in one place.
//
//  ── The two rules that shape the whole module ─────────────────────────────
//  1. The AUTHOR never sets `status`. "Planned" and "In progress" are promises
//     the product is making; letting the person who filed the request publish
//     them would turn the board into a wishlist that lies. Only `setStatus`
//     writes it, and only staff reach `setStatus`.
//  2. Vote counts are never accepted from a client and never stored. They are
//     `_count` on the relation, so the number on screen is the number of rows,
//     and there is no denormalised column to drift or to forge.
//
//  Nothing here re-implements infrastructure: moderation is assertPublishable,
//  rate limiting is the shared POLICY at the route, admin authorisation is
//  requireAdminApi, and notifications are `notify`.
// ════════════════════════════════════════════════════════════════════════════

export * from "./shared";

/**
 * What the PUBLIC may see. Written as an explicit projection, never `include`.
 *
 * `adminNote` is staff-only, and the way it leaks is somebody returning a whole
 * Prisma object one day. Listing the columns means a new sensitive field is
 * invisible by default and has to be added here on purpose.
 */
const PUBLIC_SELECT = {
  id: true,
  title: true,
  body: true,
  category: true,
  status: true,
  publicNote: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  author: { select: { username: true, name: true, image: true } },
  _count: { select: { votes: true } },
} satisfies Prisma.FeedbackItemSelect;

/** Exactly what PUBLIC_SELECT returns, plus the viewer's own vote flag. */
export interface PublicFeedback {
  id: string;
  title: string;
  body: string;
  category: string;
  status: string;
  publicNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  author: { username: string | null; name: string | null; image: string | null } | null;
  _count: { votes: number };
  /** Whether the VIEWER has voted. Never part of the row itself. */
  viewerVoted?: boolean;
}

export type Sort = "top" | "new" | "updated";

function orderFor(sort: Sort): Prisma.FeedbackItemOrderByWithRelationInput[] {
  switch (sort) {
    // Ordered by the DATABASE, not by fetching everything and sorting in JS.
    case "top": return [{ votes: { _count: "desc" } }, { createdAt: "desc" }];
    case "updated": return [{ updatedAt: "desc" }];
    default: return [{ createdAt: "desc" }];
  }
}

export const PAGE_SIZE = 25;

/**
 * One page of the board.
 *
 * `viewerId` only decides whether each row is marked as already voted — it
 * never changes WHICH rows are returned. A board that showed different items to
 * different people would not be a board.
 */
export async function listFeedback(opts: {
  category?: string;
  status?: string;
  q?: string;
  sort?: Sort;
  page?: number;
  viewerId?: string | null;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.FeedbackItemWhereInput = {
    // Hidden items are gone from every public read. The row survives for the
    // audit trail; it is not board content any more.
    hiddenAt: null,
    ...(isCategory(opts.category) ? { category: opts.category } : {}),
    ...(isStatus(opts.status) ? { status: opts.status } : {}),
    ...(opts.q
      ? {
          OR: [
            { title: { contains: opts.q, mode: "insensitive" } },
            { body: { contains: opts.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.feedbackItem.findMany({
      where,
      orderBy: orderFor(opts.sort ?? "top"),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: PUBLIC_SELECT,
    }),
    prisma.feedbackItem.count({ where }),
  ]);

  const voted = await votedIds(opts.viewerId, rows.map((r) => r.id));
  return {
    rows: rows.map((r) => ({ ...r, viewerVoted: voted.has(r.id) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * Which of these items has the viewer already voted for?
 *
 * ONE query for the whole page rather than one per row — the N+1 this avoids is
 * the difference between 1 and 26 round-trips on a full board.
 */
async function votedIds(viewerId: string | null | undefined, ids: string[]): Promise<Set<string>> {
  if (!viewerId || ids.length === 0) return new Set();
  const rows = await prisma.feedbackVote.findMany({
    where: { userId: viewerId, feedbackId: { in: ids } },
    select: { feedbackId: true },
  });
  return new Set(rows.map((r) => r.feedbackId));
}

/** One item, or null when it does not exist or has been hidden. */
export async function getFeedback(id: string, viewerId?: string | null) {
  const row = await prisma.feedbackItem.findFirst({
    where: { id, hiddenAt: null },
    select: PUBLIC_SELECT,
  });
  if (!row) return null;
  const voted = await votedIds(viewerId, [row.id]);
  return { ...row, viewerVoted: voted.has(row.id) };
}

/** The signed-in member's own submissions, hidden ones included so they know. */
export async function myFeedback(userId: string) {
  return prisma.feedbackItem.findMany({
    where: { authorId: userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { ...PUBLIC_SELECT, hiddenAt: true },
  });
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * File a new item.
 *
 * `authorId` is the SESSION's user id at the call site — there is no parameter
 * anywhere in this module that lets a caller name a different author, which is
 * the only way to make forged authorship impossible rather than merely checked.
 */
export async function createFeedback(
  authorId: string,
  input: { title: string; body: string; category: string },
): Promise<CreateResult> {
  const title = input.title.trim();
  const body = input.body.trim();

  if (!isCategory(input.category)) return { ok: false, error: "Pick a category." };
  if (title.length < TITLE_MIN) return { ok: false, error: "Give it a title — a few words is plenty." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Titles are ${TITLE_MAX} characters or fewer.` };
  if (body.length < BODY_MIN) return { ok: false, error: "Say a little more about what you have in mind." };
  if (body.length > BODY_MAX) return { ok: false, error: `Descriptions are ${BODY_MAX} characters or fewer.` };

  // The SAME moderation the forums and gym posts use. Throws a user-facing
  // sentence; nothing here re-implements the rules or the copy.
  try {
    await assertPublishable(`${title}\n\n${body}`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That could not be posted." };
  }

  const row = await prisma.feedbackItem.create({
    // `status` is absent on purpose. It takes its schema default of OPEN, and
    // there is no code path by which a submitter influences it.
    data: { authorId, title, body, category: input.category },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

/**
 * Items whose title looks like this one — the "somebody already asked for this"
 * step, before a duplicate is filed.
 *
 * A plain case-insensitive contains over the significant words. Deliberately
 * NOT embeddings or an external classifier: this is a nicety on a submission
 * form, and buying it with a network dependency and a bill would be the wrong
 * trade for what it saves.
 */
export async function similarFeedback(title: string, limit = 4) {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6);
  if (words.length === 0) return [];

  return prisma.feedbackItem.findMany({
    where: { hiddenAt: null, OR: words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })) },
    orderBy: { votes: { _count: "desc" } },
    take: limit,
    select: { id: true, title: true, status: true, _count: { select: { votes: true } } },
  });
}

export type VoteResult = { ok: true; voted: boolean; count: number } | { ok: false; error: string };

/**
 * Cast a vote. IDEMPOTENT.
 *
 * ── Why this cannot double-count ──────────────────────────────────────────
 * The composite primary key `@@id([feedbackId, userId])` is the constraint, so
 * a second insert is a database error rather than something this function has
 * to remember to check. `createMany({ skipDuplicates })` turns that into a
 * no-op, which is what makes two SIMULTANEOUS requests from one account resolve
 * to exactly one row — the check-then-insert version would let both through the
 * check and race the constraint into a 500 (CLAUDE.md rule 4).
 *
 * The returned count is read AFTER the write, from the rows themselves.
 */
export async function voteFeedback(userId: string, feedbackId: string): Promise<VoteResult> {
  const item = await prisma.feedbackItem.findFirst({
    where: { id: feedbackId, hiddenAt: null },
    select: { id: true },
  });
  // Uniform refusal: a hidden item and a nonexistent one look identical, so the
  // endpoint is not a way to enumerate what moderation has removed.
  if (!item) return { ok: false, error: "That feedback is no longer available." };

  await prisma.feedbackVote.createMany({
    data: [{ feedbackId, userId }],
    skipDuplicates: true,
  });

  return { ok: true, voted: true, count: await countVotes(feedbackId) };
}

/** Withdraw a vote. Also idempotent — deleting nothing is a success. */
export async function unvoteFeedback(userId: string, feedbackId: string): Promise<VoteResult> {
  await prisma.feedbackVote.deleteMany({ where: { feedbackId, userId } });
  return { ok: true, voted: false, count: await countVotes(feedbackId) };
}

const countVotes = (feedbackId: string) => prisma.feedbackVote.count({ where: { feedbackId } });

// ── Staff ──────────────────────────────────────────────────────────────────

export type StatusResult = { ok: true } | { ok: false; error: string };

/**
 * Move an item through its lifecycle. STAFF ONLY.
 *
 * The caller is responsible for having established that `staffId` is staff —
 * every route that reaches this calls requireAdminApi first. The audit row is
 * written in the same transaction as the change, so there is no path that
 * alters a public status without leaving a record of who did it.
 */
export async function setStatus(
  staffId: string,
  feedbackId: string,
  status: string,
  opts: { publicNote?: string; adminNote?: string } = {},
): Promise<StatusResult> {
  if (!isStatus(status)) return { ok: false, error: "Unknown status." };

  const row = await prisma.feedbackItem.findUnique({
    where: { id: feedbackId },
    select: { id: true, status: true, authorId: true, title: true },
  });
  if (!row) return { ok: false, error: "That feedback no longer exists." };

  const resolved = status === "COMPLETED" || status === "DECLINED";

  await prisma.$transaction(async (tx) => {
    await tx.feedbackItem.update({
      where: { id: feedbackId },
      data: {
        status,
        publicNote: opts.publicNote?.trim() || null,
        adminNote: opts.adminNote?.trim() || null,
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? staffId : null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: staffId,
        action: "feedback.status",
        entity: "FeedbackItem",
        entityId: feedbackId,
        meta: { previousStatus: row.status, newStatus: status, hasPublicNote: Boolean(opts.publicNote) },
      },
    });
  });

  // Tell the author their idea moved — the one notification this feature sends.
  // Deliberately NOT one per upvote: that is the change that turns a board into
  // a notification firehose and gets the whole feature muted.
  if (row.authorId && row.authorId !== staffId) {
    await notify(prisma, row.authorId, {
      type: "FEEDBACK_STATUS",
      title: `Your feedback is now ${status.replace("_", " ").toLowerCase()}`,
      body: row.title,
      url: `/feedback/${feedbackId}`,
    }).catch(() => {});
  }

  return { ok: true };
}

/** Moderation removal. Soft, audited, reversible. */
export async function setHidden(staffId: string, feedbackId: string, hidden: boolean): Promise<StatusResult> {
  const row = await prisma.feedbackItem.findUnique({ where: { id: feedbackId }, select: { id: true } });
  if (!row) return { ok: false, error: "That feedback no longer exists." };

  await prisma.$transaction(async (tx) => {
    await tx.feedbackItem.update({
      where: { id: feedbackId },
      data: { hiddenAt: hidden ? new Date() : null },
    });
    await tx.auditLog.create({
      data: {
        actorId: staffId,
        action: hidden ? "feedback.hide" : "feedback.unhide",
        entity: "FeedbackItem",
        entityId: feedbackId,
      },
    });
  });
  return { ok: true };
}

/** The operator queue. Includes hidden items and the staff-only note. */
export async function listForStaff(opts: { status?: string; category?: string; q?: string; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.FeedbackItemWhereInput = {
    ...(isStatus(opts.status) ? { status: opts.status } : {}),
    ...(isCategory(opts.category) ? { category: opts.category } : {}),
    ...(opts.q ? { title: { contains: opts.q, mode: "insensitive" } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.feedbackItem.findMany({
      where,
      orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, title: true, body: true, category: true, status: true,
        publicNote: true, adminNote: true, hiddenAt: true,
        createdAt: true, updatedAt: true,
        author: { select: { username: true, name: true } },
        _count: { select: { votes: true } },
      },
    }),
    prisma.feedbackItem.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Counters for the Operations card. */
export async function feedbackStats() {
  const grouped = await prisma.feedbackItem.groupBy({
    by: ["status"],
    where: { hiddenAt: null },
    _count: { _all: true },
  });
  const by = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
  return {
    open: by.OPEN ?? 0,
    planned: by.PLANNED ?? 0,
    inProgress: by.IN_PROGRESS ?? 0,
    completed: by.COMPLETED ?? 0,
    declined: by.DECLINED ?? 0,
    total: STATUSES.reduce((n, s) => n + (by[s] ?? 0), 0),
  };
}

export { CATEGORIES, STATUSES };
export type { FeedbackCategory, FeedbackStatus };
