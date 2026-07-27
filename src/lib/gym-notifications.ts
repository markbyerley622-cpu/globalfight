import "server-only";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications-store";
import { followerIdsToNotify, filterByPreference } from "@/lib/follow-targets";
import { log } from "@/lib/scraper/logger";
import { publicDisplayName } from "@/lib/display-name";

// ════════════════════════════════════════════════════════════════════════════
//  Gym review → notifications. One deterministic pipeline.
//
//    review saved → owner notified → followers notified → preferences applied
//                 → push policy applied (inside notify) → unread count updated
//
//  Written as a fan-out over the EXISTING notify(), which already owns dedupe, the
//  push policy and the unread count. Nothing here writes a Notification row
//  directly, because a second path into that table is how two systems start
//  disagreeing about what "unread" means.
//
//  It never throws. A review is the user's content and must save whether or not
//  anyone could be told about it — the same rule settlement follows for results.
// ════════════════════════════════════════════════════════════════════════════

/** Everything a notification needs to render, resolved once. No lookups at render. */
interface GymRef {
  id: string;
  slug: string;
  name: string;
  ownerId: string | null;
}

/**
 * Deep link into the gym's REVIEWS, not the gym. A notification that says "new
 * review" and lands on a profile leaves the reader to go find it.
 */
const reviewsUrl = (slug: string) => `/gyms/${slug}#reviews`;

async function gymRef(gymId: string): Promise<GymRef | null> {
  return prisma.gym.findUnique({
    where: { id: gymId },
    select: { id: true, slug: true, name: true, ownerId: true },
  });
}

export type ReviewAction = "created" | "edited" | "deleted";

/**
 * Fan a review out to the gym's owner and followers.
 *
 * `authorId` is excluded from both: nobody is notified about their own review, and
 * an owner reviewing their own gym is not told about it either.
 */
export async function notifyGymReview(
  gymId: string,
  authorId: string,
  action: ReviewAction,
): Promise<{ owner: boolean; followers: number }> {
  try {
    const gym = await gymRef(gymId);
    if (!gym) return { owner: false, followers: 0 };

    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: { username: true, name: true },
    });
    const who = author ? publicDisplayName(author) : "Someone";

    // ── the owner ────────────────────────────────────────────────────────────
    // Told about every action, including edits and deletions: a review changing
    // under them is exactly what an owner needs to know. Still preference-gated —
    // owning a gym is not consent to be notified.
    let owner = false;
    if (gym.ownerId && gym.ownerId !== authorId) {
      const [allowed] = await filterByPreference([gym.ownerId], "gym");
      if (allowed) {
        const copy = {
          created: { title: `New review of ${gym.name}`, body: `${who} left a review.`, icon: "review" },
          edited: { title: `A review of ${gym.name} was edited`, body: `${who} updated their review.`, icon: "edit" },
          deleted: { title: `A review of ${gym.name} was removed`, body: `${who} deleted their review.`, icon: "removed" },
        }[action];
        await notify(prisma, gym.ownerId, {
          type: "GYM_REVIEW",
          ...copy,
          url: reviewsUrl(gym.slug),
          // Per author per action: an edit war cannot buzz the owner repeatedly,
          // but a genuinely new review from someone else still lands.
          dedupeKey: `gym_review:${gymId}:${authorId}:${action}`,
        });
        owner = true;
      }
    }

    // ── followers ────────────────────────────────────────────────────────────
    // Only NEW reviews. Followers care that a gym is being reviewed; they do not
    // care that someone fixed a typo, and sending that is how a category gets muted.
    let followers = 0;
    if (action === "created") {
      const ids = await followerIdsToNotify(
        { type: "gym", id: gymId },
        { exclude: [authorId, gym.ownerId] },
      );
      // Sequential on purpose: notify() writes and may send a push, and a gym with
      // thousands of followers should not open thousands of concurrent connections.
      for (const userId of ids) {
        await notify(prisma, userId, {
          type: "GYM_REVIEW",
          title: `${gym.name} has a new review`,
          body: `${who} rated a gym you follow.`,
          url: reviewsUrl(gym.slug),
          icon: "review",
          dedupeKey: `gym_review:${gymId}:${authorId}:created`,
          // One lit phone per gym, not one per review — the same tag rule the
          // per-card pick results use.
          tag: `gym:${gymId}`,
        });
        followers += 1;
      }
    }

    log.info({ op: "gym.review.notify", gymId, action, owner, followers }, "gym review fan-out");
    return { owner, followers };
  } catch (e) {
    // The review is saved; being unable to tell anyone is not a reason to fail it.
    log.error({ op: "gym.review.notify", gymId, err: (e as Error).message }, "gym review fan-out FAILED");
    return { owner: false, followers: 0 };
  }
}
