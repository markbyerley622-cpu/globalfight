import "server-only";
import type { Prisma, CardRarity } from "@prisma/client";
import { prisma } from "@/lib/db";

// ── Collectibles ────────────────────────────────────────────────────────────
// The ownership spine (no gambling). Every fighter is a collectible; a user
// EARNS a card — today by predicting correctly. Rarity derives from the bout's
// stakes. Packs / marketplace build on this record later; the card art is the
// fighter's existing processed photo, so no new assets are required.

type Db = Prisma.TransactionClient;

/** A bout's stakes → the rarity of the card its correct-callers earn. */
export function rarityForFight(f: { titleFight: boolean; mainEvent: boolean; coMain: boolean }): CardRarity {
  if (f.titleFight) return "CHAMPION";
  if (f.mainEvent) return "EPIC";
  if (f.coMain) return "RARE";
  return "BASE";
}

export async function awardCard(
  db: Db,
  userId: string,
  fighterId: string,
  input: { rarity: CardRarity; reason: string; fightId?: string },
) {
  return db.cardAward.create({
    data: { userId, fighterId, rarity: input.rarity, reason: input.reason, fightId: input.fightId ?? null },
  });
}

export async function getUserCards(userId: string) {
  return prisma.cardAward.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { fighter: { select: { slug: true, name: true, imageUrl: true, thumbUrl: true, countryCode: true } } },
  });
}
