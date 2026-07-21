import { prisma } from "@/lib/db";
import { SPORT_LABEL } from "@/lib/sports";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Combat Reviews fighter";

export default async function Image({ params }: { params: { slug: string } }) {
  const f = await prisma.fighter.findUnique({
    where: { slug: params.slug },
    select: {
      name: true, nickname: true, sport: true, nationality: true, gym: true,
      wins: true, losses: true, draws: true, koWins: true,
    },
  });

  if (!f) return renderOgCard({ eyebrow: "Fighter", headline: "Fighter not found" });

  const hasRecord = f.wins || f.losses || f.draws;
  const record = hasRecord ? `${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ""}` : null;
  const koRate = f.wins > 0 ? Math.round((f.koWins / f.wins) * 100) : 0;

  return renderOgCard({
    eyebrow: SPORT_LABEL[f.sport] ?? "Fighter",
    headline: f.name,
    sub: f.nickname ? `"${f.nickname}"` : null,
    // The record IS the headline stat for a fighter — it earns the badge slot.
    badge: record,
    chips: [
      f.nationality,
      f.gym,
      koRate >= 20 ? `${koRate}% KO` : null,
      hasRecord ? `${f.wins + f.losses + f.draws} pro bouts` : null,
    ],
  });
}
