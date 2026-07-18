import "server-only";
import { prisma } from "@/lib/db";
import { createThread } from "@/lib/forum/repo";
import { resolvePromotion } from "@/lib/promotions";
import type { Sport } from "@prisma/client";

// ── Entity-linked discussion threads ────────────────────────────────────────
// Every event / fighter / promotion gets ONE thread, provisioned on demand and
// seeded with a system-authored opening post (anti-cold-start: the room is never
// empty). Mirrors the existing video-discussion pattern; reuses createThread and
// the whole forum stack (posts, reactions, realtime) — nothing duplicated.

export interface EntityThread {
  slug: string;
  categorySlug: string;
  locked: boolean;
  authorId: string;
  replyCount: number;
}

const SYSTEM_EMAIL = "system@combatreviews.local";
let systemUserId: string | null = null;

/** The account that authors auto-provisioned threads and seed posts. */
async function ensureSystemUser(): Promise<string> {
  if (systemUserId) return systemUserId;
  const u = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    update: {},
    create: { email: SYSTEM_EMAIL, name: "Combat Reviews", username: "combatreviews", registryRole: "media" },
    select: { id: true },
  });
  systemUserId = u.id;
  return u.id;
}

// Sport → forum category slug (categories are seeded in forum/repo.ts).
const SPORT_CATEGORY: Partial<Record<Sport, string>> = {
  MMA: "mma", BOXING: "boxing", MUAY_THAI: "muay-thai", KICKBOXING: "kickboxing", K1: "kickboxing",
  BARE_KNUCKLE: "bare-knuckle", BJJ: "bjj", BJJ_NOGI: "bjj", WRESTLING: "wrestling",
  JUDO: "judo", TAEKWONDO: "taekwondo", SAMBO: "sambo", COMBAT_SAMBO: "sambo",
};
const categoryForSport = (s: Sport | null | undefined) => (s && SPORT_CATEGORY[s]) || "general";

async function provision(
  find: () => Promise<EntityThread | null>,
  make: () => Promise<EntityThread>,
): Promise<EntityThread> {
  const existing = await find();
  if (existing) return existing;
  try {
    return await make();
  } catch {
    // Lost a create race (the entity link is @unique) — return the winner.
    const now = await find();
    if (now) return now;
    throw new Error("Could not provision discussion thread");
  }
}

function selectThread() {
  return { slug: true, category: { select: { slug: true } }, locked: true, authorId: true, replyCount: true } as const;
}
type ThreadRow = { slug: string; category: { slug: string }; locked: boolean; authorId: string; replyCount: number };
const map = (t: ThreadRow): EntityThread => ({
  slug: t.slug, categorySlug: t.category.slug, locked: t.locked, authorId: t.authorId, replyCount: t.replyCount,
});

export async function getOrCreateEventThread(event: { id: string; name: string; sport: Sport }): Promise<EntityThread> {
  return provision(
    async () => {
      const t = await prisma.forumThread.findUnique({ where: { eventId: event.id }, select: selectThread() });
      return t ? map(t) : null;
    },
    async () => {
      const author = await ensureSystemUser();
      const t = await createThread({
        authorId: author,
        categorySlug: categoryForSport(event.sport),
        title: `${event.name} — discussion`.slice(0, 155),
        content: `Predictions, live reactions and results for **${event.name}**. Make your picks, back your read, and see who called it.`,
        eventId: event.id,
        kind: "discussion",
      });
      return { slug: t.slug, categorySlug: t.categorySlug, locked: t.locked, authorId: t.authorId, replyCount: t.replyCount };
    },
  );
}

export async function getOrCreateFighterThread(fighter: { id: string; name: string; sport: Sport }): Promise<EntityThread> {
  return provision(
    async () => {
      const t = await prisma.forumThread.findUnique({ where: { fighterId: fighter.id }, select: selectThread() });
      return t ? map(t) : null;
    },
    async () => {
      const author = await ensureSystemUser();
      const t = await createThread({
        authorId: author,
        categorySlug: categoryForSport(fighter.sport),
        title: `${fighter.name} — fan discussion`.slice(0, 155),
        content: `Talk **${fighter.name}** — form, matchups, and what's next.`,
        fighterId: fighter.id,
        kind: "discussion",
      });
      return { slug: t.slug, categorySlug: t.categorySlug, locked: t.locked, authorId: t.authorId, replyCount: t.replyCount };
    },
  );
}

/** Read-only counts for badges — never provisions (cheap, safe on list pages). */
export async function getEventThreadReplyCount(eventId: string): Promise<number | null> {
  const t = await prisma.forumThread.findUnique({ where: { eventId }, select: { replyCount: true } });
  return t?.replyCount ?? null;
}
