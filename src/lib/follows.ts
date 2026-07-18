import "server-only";
import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";

// ── Following ───────────────────────────────────────────────────────────────
// Wires the previously-dead FavoriteFighter table + the new FavoritePromotion
// table into real follow toggles. Promotions are keyed by REGISTRY slug
// (resolvePromotion().slug) so a follow is stable regardless of the free-text
// promotion name on an event. These feed the personalized home rail.

export async function toggleFollowFighter(userId: string, fighterSlug: string): Promise<{ following: boolean }> {
  const f = await prisma.fighter.findUnique({ where: { slug: fighterSlug }, select: { id: true } });
  if (!f) throw new Error("Fighter not found");
  const key = { userId_fighterId: { userId, fighterId: f.id } };
  const existing = await prisma.favoriteFighter.findUnique({ where: key, select: { userId: true } });
  if (existing) {
    await prisma.favoriteFighter.delete({ where: key });
    return { following: false };
  }
  await prisma.favoriteFighter.create({ data: { userId, fighterId: f.id } });
  return { following: true };
}

export async function isFollowingFighter(userId: string, fighterId: string): Promise<boolean> {
  const row = await prisma.favoriteFighter.findUnique({
    where: { userId_fighterId: { userId, fighterId } },
    select: { userId: true },
  });
  return !!row;
}

/** `promotion` is any free-text promotion string; it's normalised to a registry slug. */
export async function toggleFollowPromotion(userId: string, promotion: string): Promise<{ following: boolean }> {
  const slug = resolvePromotion(promotion).slug;
  const key = { userId_promotion: { userId, promotion: slug } };
  const existing = await prisma.favoritePromotion.findUnique({ where: key, select: { userId: true } });
  if (existing) {
    await prisma.favoritePromotion.delete({ where: key });
    return { following: false };
  }
  await prisma.favoritePromotion.create({ data: { userId, promotion: slug } });
  return { following: true };
}

export async function isFollowingPromotion(userId: string, promotion: string): Promise<boolean> {
  const slug = resolvePromotion(promotion).slug;
  const row = await prisma.favoritePromotion.findUnique({
    where: { userId_promotion: { userId, promotion: slug } },
    select: { userId: true },
  });
  return !!row;
}

/** Registry slugs of the promotions a user follows (for personalized surfaces). */
export async function getFollowedPromotionSlugs(userId: string): Promise<string[]> {
  const rows = await prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } });
  return rows.map((r) => r.promotion);
}

/** Fighter ids a user follows (cheap set for badging cards). */
export async function getFollowedFighterIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } });
  return new Set(rows.map((r) => r.fighterId));
}
