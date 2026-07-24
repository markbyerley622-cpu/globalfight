import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════
//  Fighter merge — collapse a duplicate INTO a canonical record without losing
//  data. Every relation is re-pointed (not deleted): fights, rankings, snapshots,
//  champions, titles, socials, media, aliases, external ids, predictions,
//  favourites, awards, forum thread. Unique-constrained relations are
//  conflict-resolved (keep the winner's, drop the loser's colliding row). The
//  loser's name + slug become aliases of the winner so search still finds them.
//  All in one transaction: it either fully merges or changes nothing.
// ════════════════════════════════════════════════════════════════════════

/** Higher = keep as the canonical record. Real data beats a sparse duplicate. */
export interface Completeness {
  id: string;
  score: number;
}

async function completenessOf(id: string): Promise<number> {
  const [f, fights, rankings] = await Promise.all([
    prisma.fighter.findUnique({
      where: { id },
      select: { photoUrl: true, imageUrl: true, wins: true, losses: true, draws: true, countryCode: true, nickname: true },
    }),
    prisma.fight.count({ where: { OR: [{ redId: id }, { blueId: id }] } }),
    prisma.ranking.count({ where: { fighterId: id } }),
  ]);
  if (!f) return -1;
  return (
    fights * 5 +
    rankings * 4 +
    (f.photoUrl || f.imageUrl ? 6 : 0) +
    (f.wins + f.losses + f.draws > 0 ? 4 : 0) +
    (f.countryCode ? 1 : 0) +
    (f.nickname ? 1 : 0)
  );
}

/** Pick the most-complete id to keep; the rest are merged into it. */
export async function pickWinner(ids: string[]): Promise<string> {
  const scored = await Promise.all(ids.map(async (id) => ({ id, score: await completenessOf(id) })));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

/** Re-point a unique-constrained relation: keep winner's, drop loser's collisions. */
async function repointUnique<T extends { id: string }>(
  tx: Prisma.TransactionClient,
  loserRows: T[],
  keyOf: (r: T) => string,
  winnerKeys: Set<string>,
  del: (id: string) => Promise<unknown>,
  move: (id: string) => Promise<unknown>,
): Promise<void> {
  for (const r of loserRows) {
    if (winnerKeys.has(keyOf(r))) await del(r.id);
    else await move(r.id);
  }
}

/** Merge `loserId` into `winnerId`. Transactional; preserves all data. */
export async function mergeFighter(winnerId: string, loserId: string): Promise<void> {
  if (winnerId === loserId) return;

  await prisma.$transaction(async (tx) => {
    const move = { fighterId: winnerId };

    // 1. Relations with no fighter-based unique constraint → blind re-point.
    await tx.title.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.fighterAchievement.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.fighterSponsor.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.fighterMedia.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.rankSnapshot.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.champion.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.cardAward.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.fighterExternalId.updateMany({ where: { fighterId: loserId }, data: move });
    await tx.fighterAlias.updateMany({ where: { fighterId: loserId }, data: move });

    // 2. Fights (Restrict) + predictions + fight winner pointer.
    await tx.fight.updateMany({ where: { redId: loserId }, data: { redId: winnerId } });
    await tx.fight.updateMany({ where: { blueId: loserId }, data: { blueId: winnerId } });
    await tx.fight.updateMany({ where: { winnerId: loserId }, data: { winnerId } });
    await tx.prediction.updateMany({ where: { predictedWinnerId: loserId }, data: { predictedWinnerId: winnerId } });
    // A bout between the two now has the same fighter in both corners — drop it.
    await tx.fight.deleteMany({ where: { redId: winnerId, blueId: winnerId } });

    // 3. Ranking — unique(weightClassId, isPoundForPound, fighterId).
    const winRanks = await tx.ranking.findMany({ where: { fighterId: winnerId }, select: { weightClassId: true, isPoundForPound: true } });
    const winRankKeys = new Set(winRanks.map((r) => `${r.weightClassId}|${r.isPoundForPound}`));
    const loseRanks = await tx.ranking.findMany({ where: { fighterId: loserId }, select: { id: true, weightClassId: true, isPoundForPound: true } });
    await repointUnique(tx, loseRanks, (r) => `${r.weightClassId}|${r.isPoundForPound}`, winRankKeys,
      (id) => tx.ranking.delete({ where: { id } }), (id) => tx.ranking.update({ where: { id }, data: move }));

    // 4. FighterSocial — unique(fighterId, platform).
    const winSocials = await tx.fighterSocial.findMany({ where: { fighterId: winnerId }, select: { platform: true } });
    const winPlatforms = new Set(winSocials.map((s) => s.platform));
    const loseSocials = await tx.fighterSocial.findMany({ where: { fighterId: loserId }, select: { id: true, platform: true } });
    await repointUnique(tx, loseSocials, (s) => s.platform, winPlatforms,
      (id) => tx.fighterSocial.delete({ where: { id } }), (id) => tx.fighterSocial.update({ where: { id }, data: move }));

    // 5. FighterClaim — unique(fighterId, claimantId).
    const winClaims = await tx.fighterClaim.findMany({ where: { fighterId: winnerId }, select: { claimantId: true } });
    const winClaimants = new Set(winClaims.map((c) => c.claimantId));
    const loseClaims = await tx.fighterClaim.findMany({ where: { fighterId: loserId }, select: { id: true, claimantId: true } });
    await repointUnique(tx, loseClaims, (c) => c.claimantId, winClaimants,
      (id) => tx.fighterClaim.delete({ where: { id } }), (id) => tx.fighterClaim.update({ where: { id }, data: move }));

    // 6. FavoriteFighter — composite PK (userId, fighterId).
    const winFavs = await tx.favoriteFighter.findMany({ where: { fighterId: winnerId }, select: { userId: true } });
    const winFavUsers = new Set(winFavs.map((f) => f.userId));
    const loseFavs = await tx.favoriteFighter.findMany({ where: { fighterId: loserId }, select: { userId: true } });
    for (const fav of loseFavs) {
      if (winFavUsers.has(fav.userId)) await tx.favoriteFighter.delete({ where: { userId_fighterId: { userId: fav.userId, fighterId: loserId } } });
      else await tx.favoriteFighter.update({ where: { userId_fighterId: { userId: fav.userId, fighterId: loserId } }, data: move });
    }

    // 7. ForumThread — fighterId is @unique (1:1). Winner keeps its thread.
    const winThread = await tx.forumThread.findFirst({ where: { fighterId: winnerId }, select: { id: true } });
    if (winThread) await tx.forumThread.updateMany({ where: { fighterId: loserId }, data: { fighterId: null } });
    else await tx.forumThread.updateMany({ where: { fighterId: loserId }, data: move });

    // 8. Preserve identity: the loser's name/slug become aliases of the winner.
    const loser = await tx.fighter.findUnique({ where: { id: loserId }, select: { name: true, slug: true } });
    if (loser) {
      for (const alias of [loser.name, loser.slug]) {
        await tx.fighterAlias.create({ data: { fighterId: winnerId, alias, normalized: alias.toLowerCase(), source: "merge" } });
      }
    }

    // 9. Loser now has no references → delete.
    await tx.fighter.delete({ where: { id: loserId } });
  }, { timeout: 20_000 });
}

export interface MergeReport {
  groups: number;
  merged: number;
  errors: { key: string; error: string }[];
}

/**
 * Find every set of fighters sharing a normalised name and merge each set into
 * its most-complete member. Idempotent — a second run finds nothing.
 */
export async function repairDuplicateFighters(): Promise<MergeReport> {
  const dupKeys = await prisma.$queryRaw<{ key: string }[]>`
    SELECT lower(name) AS key FROM "Fighter" GROUP BY lower(name) HAVING count(*) > 1`;
  const report: MergeReport = { groups: dupKeys.length, merged: 0, errors: [] };

  for (const { key } of dupKeys) {
    try {
      const ids = (await prisma.fighter.findMany({
        where: { name: { equals: key, mode: "insensitive" } }, select: { id: true },
      })).map((f) => f.id);
      if (ids.length < 2) continue;
      const winner = await pickWinner(ids);
      for (const loser of ids.filter((id) => id !== winner)) {
        await mergeFighter(winner, loser);
        report.merged++;
      }
    } catch (e) {
      report.errors.push({ key, error: (e as Error).message });
    }
  }
  return report;
}
