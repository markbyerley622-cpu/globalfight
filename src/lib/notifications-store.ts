import "server-only";
import type { Prisma, NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pushToUsers } from "@/lib/push/send";

// ── Notifications (personal, stored) ────────────────────────────────────────
// The single user-targeted notification engine. Distinct from
// /api/notifications, which composes a PUBLIC content ticker (news/results/
// upcoming) from repo data. Any subsystem emits here via notify().

type Db = Prisma.TransactionClient;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  url?: string | null;
  icon?: string | null;
  /** Once-ever key, e.g. `follow:<followerId>`. The (userId, dedupeKey)
   *  unique makes a repeat a no-op — and a no-op sends no push, so an
   *  unfollow/refollow loop cannot be used to buzz someone's phone.
   *  Omit for genuinely repeatable notifications (a reply, a pick result). */
  dedupeKey?: string | null;
  /** Collapses on the DEVICE: a later push with the same tag replaces the
   *  earlier one. A twelve-bout card should light the phone once, not twelve
   *  times, while all twelve rows still land in the in-app list. */
  tag?: string;
}

export async function notify(db: Db, userId: string, input: NotifyInput): Promise<void> {
  // createMany(skipDuplicates) rather than create(): it is the only write that
  // is safe to repeat. Postgres treats NULLs as distinct, so rows without a
  // dedupeKey are unaffected and still insert every time.
  const { count } = await db.notification.createMany({
    data: [{
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
      icon: input.icon ?? null,
      dedupeKey: input.dedupeKey ?? null,
    }],
    skipDuplicates: true,
  });
  if (count === 0) return; // already delivered — do not push a second time

  // Push is fire-and-forget and deliberately NOT awaited: `db` here is often a
  // transaction client, and blocking a transaction on a third-party HTTP call
  // would hold a row lock for the length of someone's network. The stored row
  // is the source of truth; push is a nudge toward it.
  void pushToUsers([userId], input.type, {
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    icon: input.icon ?? null,
    tag: input.tag,
  }).catch(() => {});
}

/**
 * The SAME notification to MANY users, in one insert.
 *
 * notify() is per-user, which is correct for a reply or a pick payout but wrong
 * for a fan-out: a promotion with 5,000 followers meant 5,000 round-trips and
 * 5,000 push calls. Both the social fan-out and the Return Engine need the batched
 * shape, and they each had their own — two code paths into one table, which is how
 * two systems start disagreeing about what "unread" means. This is the one.
 *
 * Returns how many rows were actually CREATED (not how many were asked for), so a
 * caller can distinguish "told 40 people" from "re-ran and told nobody".
 */
export async function notifyMany(userIds: string[], input: NotifyInput): Promise<number> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return 0;

  const row = {
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    icon: input.icon ?? null,
    dedupeKey: input.dedupeKey ?? null,
  };

  // Who already had this? Anyone in this set is a row the insert will skip, and
  // must NOT be pushed a second time. Only meaningful when there is a dedupeKey —
  // without one every row is new by definition.
  const alreadyHad = input.dedupeKey
    ? new Set(
        (
          await prisma.notification.findMany({
            where: { dedupeKey: input.dedupeKey, userId: { in: ids } },
            select: { userId: true },
          })
        ).map((n) => n.userId),
      )
    : new Set<string>();

  const { count } = await prisma.notification.createMany({
    data: ids.map((userId) => ({ userId, ...row })),
    skipDuplicates: true,
  });
  if (count === 0) return 0;

  // ONE push call for the whole group — the payload is identical for everyone,
  // which is precisely why this batched path exists.
  const pushTo = ids.filter((id) => !alreadyHad.has(id));
  if (pushTo.length) {
    void pushToUsers(pushTo, input.type, {
      title: row.title,
      body: row.body,
      url: row.url,
      icon: row.icon,
      tag: input.tag,
    }).catch(() => {});
  }
  return count;
}

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

/** One notification row, scoped to its owner. */
export type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];

/**
 * A page of notifications, newest first, with an opaque cursor.
 *
 * KEYSET pagination, not offset: the list is written to constantly (that is the
 * whole point of it), and `skip` on a list that grows at the head shows the reader
 * the same row twice and silently hides another. The cursor is the row id, which
 * Prisma resolves against the (userId, createdAt) index.
 *
 * `take` is fetched +1 so "is there more?" is answered by the same query rather
 * than a second count() — a count on a table with a year of history is the query
 * that gets expensive first.
 */
export async function pageNotifications(
  userId: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

/**
 * Mark specific rows read. Scoped by userId in the WHERE — the id comes from a
 * client, and an updateMany that trusted it would let anyone mark a stranger's
 * notification read. A group is many ids in one call, which is what keeps tapping
 * a collapsed group of five from being five requests.
 */
export async function markRead(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { count } = await prisma.notification.updateMany({
    where: { id: { in: ids }, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

/** Delete rows the viewer owns. Same scoping rule as markRead, same reason. */
export async function deleteNotifications(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { count } = await prisma.notification.deleteMany({ where: { id: { in: ids }, userId } });
  return count;
}
