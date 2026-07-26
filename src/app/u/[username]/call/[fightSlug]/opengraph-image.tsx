import { getVictoryCard } from "@/lib/identity/victory-card";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Prediction result on Combat Reviews";

/**
 * The share image for one resolved call — the artifact that unfurls in a feed
 * or a group chat. Reuses the ONE OG renderer (text + stat chips, no remote
 * images, so a share never renders blank), leading with the dynamic headline
 * and, on a win, the exact reputation gained as the badge. Every value comes
 * from getVictoryCard; nothing is invented.
 */
export default async function Image({ params }: { params: { username: string; fightSlug: string } }) {
  const card = await getVictoryCard(params.username, params.fightSlug);
  if (!card) return renderOgCard({ eyebrow: "Prediction", headline: "Call not found" });

  const win = card.pick.correct;
  const beat = 100 - card.calledByPct;

  return renderOgCard({
    eyebrow: card.fight.eventName ?? card.fight.promotion ?? "Prediction",
    headline: card.headline.text,
    sub: `${card.user.name} called ${card.pick.calledName}`,
    // The boast number. A correct pick always pays ≥ the floor, so a win has a
    // positive delta; a miss carries the headline alone.
    badge: win && card.repGained > 0 ? `+${card.repGained}` : null,
    chips: [
      win && card.crowdTotal >= 12 && beat >= 50 ? `Beat ${beat}% of callers` : null,
      card.user.accuracy !== null ? `${card.user.accuracy}% accuracy` : null,
      card.streak !== null && card.streak >= 2 ? `${card.streak}-fight streak` : null,
      card.user.percentile !== null ? `Top ${card.user.percentile}%` : null,
    ],
  });
}
