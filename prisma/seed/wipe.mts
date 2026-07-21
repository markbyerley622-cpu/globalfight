import { prisma } from "../../src/lib/db.ts";
import { SEED_EMAIL_DOMAIN } from "./world.mts";

// ── Wipe the seed world ─────────────────────────────────────────────────────
// Deleting the demo users cascades away everything they own — picks, cards,
// reputation events, notifications, activity, forum posts/reactions, and any
// event-discussion threads they authored (ForumThread.author onDelete: Cascade).
//
// Two things do NOT cascade and are handled explicitly:
//   • AnalyticsEvent.userId is a bare column (no FK relation) — deleted by id.
//   • Denormalised thread counters can drift if seed users left replies/reactions
//     inside a pre-existing real thread — recomputed from surviving posts.
export async function wipeWorld(): Promise<Record<string, number>> {
  const seedUsers = await prisma.user.findMany({
    where: { email: { endsWith: SEED_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const ids = seedUsers.map((u) => u.id);

  const analytics = ids.length
    ? await prisma.analyticsEvent.deleteMany({ where: { userId: { in: ids } } })
    : { count: 0 };
  const users = ids.length
    ? await prisma.user.deleteMany({ where: { id: { in: ids } } })
    : { count: 0 };

  // Recompute counters for every thread so any seed-induced drift is cleared.
  const threads = await prisma.forumThread.findMany({ select: { id: true } });
  let repaired = 0;
  for (const t of threads) {
    const posts = await prisma.forumPost.findMany({
      where: { threadId: t.id, deleted: false },
      select: { id: true, parentId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (!posts.length) continue;
    const replyCount = posts.filter((p) => p.parentId).length;
    const reactionCount = await prisma.forumReaction.count({ where: { post: { threadId: t.id } } });
    const lastPostAt = posts[posts.length - 1].createdAt;
    await prisma.forumThread.update({ where: { id: t.id }, data: { replyCount, reactionCount, lastPostAt } });
    repaired++;
  }

  return { users: users.count, analyticsEvents: analytics.count, threadsRepaired: repaired };
}
