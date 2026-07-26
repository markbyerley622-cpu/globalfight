import { getVictoryCard } from "@/lib/identity/victory-card";
import { renderVictoryOg, renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import type { CardRarity } from "@prisma/client";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Prediction result on Combat Reviews";

// Rarity → accent: title/legend bouts read gold, main events volt, the rest the
// brand red. The share image inherits the same tier the on-screen card shows.
const ACCENT: Record<CardRarity, "gold" | "volt" | "blood"> = {
  LEGEND: "gold", CHAMPION: "gold", EPIC: "volt", RARE: "blood", BASE: "blood",
};

/**
 * The share image for one resolved call — a DEDICATED victory layout (not the
 * generic OG template), so it reads instantly as a Combat Reviews win. Reuses
 * the one renderer/font/constraints in src/lib/og.tsx; every value comes from
 * getVictoryCard (cache()'d, shared with the page), nothing invented.
 */
export default async function Image({ params }: { params: { username: string; fightSlug: string } }) {
  const card = await getVictoryCard(params.username, params.fightSlug);
  if (!card) return renderOgCard({ eyebrow: "Prediction", headline: "Call not found" });

  return renderVictoryOg({
    rarityLabel: card.rarity === "BASE" ? "Called" : card.rarity[0] + card.rarity.slice(1).toLowerCase(),
    accent: ACCENT[card.rarity] ?? "blood",
    win: card.pick.correct,
    headline: card.headline.text,
    sub: `${card.user.name} called ${card.pick.calledName}`,
    eyebrow: card.fight.eventName ?? card.fight.promotion ?? null,
    badges: card.badges.map((b) => b.label),
    repGained: card.pick.correct && card.repGained > 0 ? card.repGained : null,
  });
}
