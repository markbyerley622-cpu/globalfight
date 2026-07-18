import "server-only";
import type { Prisma, ActivityType } from "@prisma/client";
import { prisma } from "@/lib/db";

// ── Activity stream ─────────────────────────────────────────────────────────
// One shared feed. Everything worth surfacing (a pick landing, a card earned, a
// follow) emits here; the homepage/profile activity feeds read from it. Emitters
// call recordActivity(); readers use the getters.

type Db = Prisma.TransactionClient;

export async function recordActivity(
  db: Db,
  userId: string,
  input: { type: ActivityType; title: string; url?: string; meta?: Prisma.InputJsonValue },
): Promise<void> {
  await db.activity.create({
    data: { userId, type: input.type, title: input.title, url: input.url ?? null, meta: input.meta ?? undefined },
  });
}

export async function getGlobalActivity(limit = 30) {
  return prisma.activity.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true, username: true, image: true } } },
  });
}

export async function getUserActivity(userId: string, limit = 30) {
  return prisma.activity.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}
