import "server-only";
import { prisma } from "@/lib/db";

// Strong profanity / slurs that shouldn't appear as user-generated titles or
// posts. Kept deliberately narrow to avoid false positives.
const RE = /\b(fuck|f\*ck|cunt|nigg(er|a)|faggot|retard)\b/i;

/**
 * Remove offensive user-generated content (forum threads/posts, clip titles).
 * Idempotent — after the first pass there's nothing left to match. Called on
 * server boot (see src/instrumentation.ts) so content like "Fuck Boris" is
 * cleared automatically on deploy without running a script by hand. Returns the
 * number of items removed.
 */
export async function purgeProfanity(): Promise<number> {
  let removed = 0;

  const threads = await prisma.forumThread.findMany({ select: { id: true, title: true } });
  const badThreads = threads.filter((t) => RE.test(t.title)).map((t) => t.id);
  if (badThreads.length) {
    await prisma.forumThread.deleteMany({ where: { id: { in: badThreads } } });
    removed += badThreads.length;
  }

  const posts = await prisma.forumPost.findMany({ where: { deleted: false }, select: { id: true, content: true } });
  const badPosts = posts.filter((p) => RE.test(p.content)).map((p) => p.id);
  if (badPosts.length) {
    await prisma.forumPost.updateMany({ where: { id: { in: badPosts } }, data: { deleted: true, content: "[removed]" } });
    removed += badPosts.length;
  }

  const clips = await prisma.clip.findMany({ select: { id: true, title: true } });
  const badClips = clips.filter((c) => RE.test(c.title)).map((c) => c.id);
  if (badClips.length) {
    await prisma.clip.updateMany({ where: { id: { in: badClips } }, data: { status: "removed" } });
    removed += badClips.length;
  }

  return removed;
}
