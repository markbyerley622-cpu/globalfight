import { getEventScorecard } from "@/lib/identity/scorecard";
import { renderVictoryOg, renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Prediction scorecard on Combat Reviews";

/**
 * The share image for a night's card — reuses the dedicated victory OG layout
 * (no new renderer), with the record in the verdict slot. Shares getEventScorecard
 * with the page (cache()'d); every value is the user's own graded record.
 */
export default async function Image({ params }: { params: { username: string; eventSlug: string } }) {
  const card = await getEventScorecard(params.username, params.eventSlug);
  if (!card) return renderOgCard({ eyebrow: "Scorecard", headline: "Card not found" });

  return renderVictoryOg({
    rarityLabel: card.perfect ? "Perfect card" : "Scorecard",
    accent: card.perfect ? "gold" : "blood",
    win: card.accuracy >= 50,
    verdict: `${card.correct} / ${card.graded}`,
    headline: card.headline,
    sub: `${card.user.name} on ${card.event.name}`,
    eyebrow: card.event.promotion ?? card.event.name,
    badges: card.badges.map((b) => b.label),
    repGained: card.repGained > 0 ? card.repGained : null,
  });
}
