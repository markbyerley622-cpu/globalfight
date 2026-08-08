import "server-only";
import { prisma } from "@/lib/db";
import { registerPreviewLoader } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A FIGHTER's preview. Wholly public — the same facts /fighters/<slug> shows.
//
//  Access-control walk: read-only, no session required, nothing viewer-scoped,
//  no writes. An unknown id is absent from the result rather than an error.
// ════════════════════════════════════════════════════════════════════════════

registerPreviewLoader("fighter", async (ids) => {
  const rows = await prisma.fighter.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, slug: true, name: true, nickname: true, sport: true,
      imageUrl: true, wins: true, losses: true, draws: true,
    },
  });

  return rows.map((f) => ({
    kind: "fighter",
    id: f.id,
    slug: f.slug,
    name: f.name,
    nickname: f.nickname,
    sport: f.sport,
    imageUrl: f.imageUrl,
    wins: f.wins,
    losses: f.losses,
    draws: f.draws,
  }));
});
