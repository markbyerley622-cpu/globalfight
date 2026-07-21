import { prisma } from "@/lib/db";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Combat Reviews rankings";

/** A rankings share names the champion and the #1 contender — the two facts
 *  that make someone open a division page. */
export default async function Image({ params }: { params: { slug: string } }) {
  const wc = await prisma.weightClass.findUnique({
    where: { slug: params.slug },
    select: {
      name: true, sport: true,
      rankings: {
        orderBy: { rank: "asc" },
        take: 2,
        select: { rank: true, fighter: { select: { name: true } } },
      },
      champions: { take: 1, select: { fighter: { select: { name: true } } } },
    },
  });

  if (!wc) return renderOgCard({ eyebrow: "Rankings", headline: "Division not found" });

  const champion = wc.champions[0]?.fighter.name ?? null;
  const top = wc.rankings.filter((r) => r.rank > 0).slice(0, 2);

  return renderOgCard({
    eyebrow: "Rankings",
    headline: wc.name,
    sub: champion ? `Champion · ${champion}` : "Divisional rankings",
    chips: [
      ...top.map((r) => `#${r.rank} ${r.fighter.name}`),
      wc.sport.replace(/_/g, " "),
    ],
  });
}
