import "server-only";
import type { Prisma, NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pushToUsers } from "@/lib/push/send";

// ── Notifications (personal, stored) ────────────────────────────────────────
// The single user-targeted notification engine. Distinct from
// /api/notifications, which composes a PUBLIC content ticker (news/results/
// upcoming) from repo data. Any subsystem emits here via notify().

type Db = Prisma.TransactionClient;

export async function notify(
  db: Db,
  userId: string,
  input: {
    type: NotificationType;
    title: string;
    body?: string;
    url?: string;
    icon?: string;
    /** Once-ever key, e.g. `follow:<followerId>`. The (userId, dedupeKey)
     *  unique makes a repeat a no-op — and a no-op sends no push, so an
     *  unfollow/refollow loop cannot be used to buzz someone's phone.
     *  Omit for genuinely repeatable notifications (a reply, a pick result). */
    dedupeKey?: string;
    /** Collapses on the DEVICE: a later push with the same tag replaces the
     *  earlier one. A twelve-bout card should light the phone once, not twelve
     *  times, while all twelve rows still land in the in-app list. */
    tag?: string;
  },
): Promise<void> {
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

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
