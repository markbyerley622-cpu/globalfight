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
  input: { type: NotificationType; title: string; body?: string; url?: string; icon?: string },
): Promise<void> {
  await db.notification.create({
    data: {
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
      icon: input.icon ?? null,
    },
  });

  // Push is fire-and-forget and deliberately NOT awaited: `db` here is often a
  // transaction client, and blocking a transaction on a third-party HTTP call
  // would hold a row lock for the length of someone's network. The stored row
  // is the source of truth; push is a nudge toward it.
  void pushToUsers([userId], input.type, {
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    icon: input.icon ?? null,
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
