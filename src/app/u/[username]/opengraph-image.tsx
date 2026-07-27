import { prisma } from "@/lib/db";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { publicDisplayName, initialsFor } from "@/lib/display-name";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Combat Reviews predictor";

/**
 * A profile share is a BOAST, so it leads with the number worth boasting about:
 * reputation in the badge, then accuracy, streak and battle record as chips.
 * This is the card that carries a battle win or a prediction win into a group
 * chat, which is why those stats are the whole design.
 */
export default async function Image({ params }: { params: { username: string } }) {
  const u = await prisma.user.findUnique({
    where: { username: params.username },
    select: {
      name: true, username: true, reputation: true,
      picksResolved: true, picksCorrect: true, pickStreak: true, bestPickStreak: true,
      battleWins: true, battleLosses: true, bestBattleStreak: true,
    },
  });

  if (!u) return renderOgCard({ eyebrow: "Predictor", headline: "Profile not found" });

  const accuracy = u.picksResolved > 0 ? Math.round((u.picksCorrect / u.picksResolved) * 100) : null;
  const battles = u.battleWins + u.battleLosses;

  return renderOgCard({
    eyebrow: "Predictor",
    // publicDisplayName, NOT u.name: people type their email into the display-name
    // field at signup, and this card was publishing it — at 80px, straight into a
    // group chat. See lib/display-name.
    headline: publicDisplayName(u),
    sub: u.picksResolved > 0 ? `${u.picksCorrect} of ${u.picksResolved} calls landed` : "Making their first calls",
    badge: `${u.reputation}`,
    badgeLabel: "Rep",
    avatarInitials: initialsFor(u),
    chips: [
      accuracy !== null ? `${accuracy}% accuracy` : null,
      battles > 0 ? `${u.battleWins}-${u.battleLosses} in battles` : null,
      u.pickStreak > 1 ? `${u.pickStreak} pick streak` : u.bestPickStreak > 1 ? `Best streak ${u.bestPickStreak}` : null,
      u.bestBattleStreak > 1 ? `${u.bestBattleStreak} battle streak` : null,
    ],
  });
}
