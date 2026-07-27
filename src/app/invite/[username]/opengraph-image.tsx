import { prisma } from "@/lib/db";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { publicDisplayName, initialsFor } from "@/lib/display-name";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "You've been invited to Combat Reviews";

/**
 * The card an INVITE renders in WhatsApp, iMessage, email and Slack.
 *
 * This is the most important share image in the product: it is the one a stranger
 * sees before they know what GlobalFight is, so it leads with the person who
 * invited them (social proof) rather than with a feature list. Their record is the
 * proof that there is something here worth beating.
 *
 * Same renderer as every other card, so an invite is recognisably the same product
 * as a result or a profile — and it carries the CR mark, which is the only part a
 * thumbnail-sized preview reliably communicates.
 */
export default async function Image({ params }: { params: { username: string } }) {
  const u = await prisma.user.findUnique({
    where: { username: params.username },
    select: {
      name: true, username: true, reputation: true,
      picksResolved: true, picksCorrect: true, bestPickStreak: true,
    },
  });

  // An invite link for a deleted or renamed account still has to render something
  // designed — a broken preview is worse than a generic one.
  if (!u) {
    return renderOgCard({
      eyebrow: "You're invited",
      headline: "Join Combat Reviews",
      sub: "Predict fights. Build a record. Settle it in the room.",
    });
  }

  const who = publicDisplayName(u);
  const accuracy = u.picksResolved > 0 ? Math.round((u.picksCorrect / u.picksResolved) * 100) : null;

  return renderOgCard({
    eyebrow: "You're invited",
    headline: `${who} wants you on the card`,
    sub: "Call the fights. Build a record. Prove you read it better.",
    avatarInitials: initialsFor(u),
    // Their reputation is the hook — "this person has 2,480 and thinks you can't
    // beat it" is a reason to tap. A brand-new inviter has nothing to boast, so the
    // badge is omitted rather than showing a proud zero.
    badge: u.reputation > 0 ? `${u.reputation}` : null,
    badgeLabel: u.reputation > 0 ? "Their rep" : null,
    chips: [
      accuracy !== null ? `${accuracy}% accuracy` : null,
      u.picksResolved > 0 ? `${u.picksResolved} calls made` : null,
      u.bestPickStreak > 1 ? `Best streak ${u.bestPickStreak}` : null,
      "Free to join",
    ],
  });
}
