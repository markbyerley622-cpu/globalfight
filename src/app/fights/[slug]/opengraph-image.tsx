import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Combat Reviews matchup";

/** A matchup share shows the tale of the tape in miniature: both records, the
 *  division, and the result once it exists. */
export default async function Image({ params }: { params: { slug: string } }) {
  const fight = await prisma.fight.findUnique({
    where: { slug: params.slug },
    select: {
      date: true, result: true, method: true, roundEnded: true, titleFight: true, scheduledRounds: true,
      winnerId: true, redId: true, blueId: true,
      weightClass: { select: { name: true } },
      red: { select: { name: true, slug: true, wins: true, losses: true, draws: true } },
      blue: { select: { name: true, slug: true, wins: true, losses: true, draws: true } },
      event: { select: { name: true, promotion: true } },
    },
  });

  if (!fight) return renderOgCard({ eyebrow: "Matchup", headline: "Fight not found" });

  const promo = resolvePromotion(fight.event?.promotion);
  const rec = (f: { wins: number; losses: number; draws: number }) =>
    f.wins || f.losses || f.draws ? `${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ""}` : null;

  const decided = fight.result !== "SCHEDULED";
  const won =
    fight.result === "WIN" && fight.winnerId
      ? fight.winnerId === fight.redId || fight.winnerId === fight.red.slug ? fight.red.name
      : fight.winnerId === fight.blueId || fight.winnerId === fight.blue.slug ? fight.blue.name : null
      : null;

  const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(fight.date);

  return renderOgCard({
    eyebrow: fight.titleFight ? "Title fight" : decided ? "Result" : "Matchup",
    headline: `${fight.red.name} vs ${fight.blue.name}`,
    sub: won ? `${won} def. ${won === fight.red.name ? fight.blue.name : fight.red.name}${fight.method ? ` · ${fight.method}` : ""}${fight.roundEnded ? ` R${fight.roundEnded}` : ""}` : fight.event?.name ?? null,
    accent: promo.brand,
    badge: "VS",
    chips: [
      rec(fight.red) ? `${fight.red.name.split(" ").pop()} ${rec(fight.red)}` : null,
      rec(fight.blue) ? `${fight.blue.name.split(" ").pop()} ${rec(fight.blue)}` : null,
      fight.weightClass?.name ?? null,
      decided ? null : when,
    ],
  });
}
