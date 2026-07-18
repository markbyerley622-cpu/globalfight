import "server-only";
import type { Prisma, NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";

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
