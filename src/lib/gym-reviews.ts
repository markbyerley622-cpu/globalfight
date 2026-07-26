import "server-only";
import { prisma } from "@/lib/db";
import { notifyGymReview } from "@/lib/gym-notifications";
import type { Prisma } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Gym reviews — the trust layer.
//
//  A gym's rating is DENORMALISED onto Gym (ratingAvg/ratingCount), exactly like
//  memberCount, so a map pin, a list row and a search result never load a review
//  row. The list itself is loaded in a fixed set of batched reads — never one
//  query per review — and ranked so the best-supported reviews lead, not merely
//  the newest.
// ════════════════════════════════════════════════════════════════════════════

export const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "professional"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const CATEGORIES = ["coaching", "facilities", "atmosphere", "cleanliness", "value"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ReviewInput {
  overall: number;
  coaching?: number | null;
  facilities?: number | null;
  atmosphere?: number | null;
  cleanliness?: number | null;
  value?: number | null;
  title?: string | null;
  body: string;
  recommended: boolean;
  skillLevel?: string | null;
  disciplines?: string[];
}

export interface ReviewDTO {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  authorImage: string | null;
  overall: number;
  categories: Record<Category, number | null>;
  title: string | null;
  body: string;
  recommended: boolean;
  skillLevel: string | null;
  disciplines: string[];
  verifiedMember: boolean;
  authorRole: string | null;
  helpfulCount: number;
  votedHelpful: boolean;
  edited: boolean;
  createdAt: string;
  isMine: boolean;
}

export interface GymReviewSummary {
  count: number;
  average: number; // 0 when no reviews
  recommendedPct: number; // 0..100
  /** Star buckets 5→1, each the count of reviews at that overall. */
  distribution: { star: number; count: number }[];
  /** Per-category averages, null when nobody rated that category. */
  categoryAverages: Record<Category, number | null>;
  verifiedCount: number;
}

export interface GymReviewData {
  summary: GymReviewSummary;
  reviews: ReviewDTO[];
  myReview: ReviewDTO | null;
}

const clampStar = (v: number | null | undefined): number | null => {
  if (v == null) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 5 ? n : null;
};

/** How many review rows the page renders. The summary is computed from DB
 *  aggregates (below), so this cap bounds the payload/memory WITHOUT skewing the
 *  headline numbers — a gym with 10k reviews costs the same as one with 10. */
const REVIEW_PAGE = 40;

const round1 = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v * 10) / 10;

/**
 * Everything a gym page needs to render reviews.
 *
 * The SUMMARY (count, average, distribution, category averages, verified /
 * recommended tallies) is computed by DB aggregates — groupBy + aggregate + two
 * counts — so it never loads review rows to add them up. The DISPLAY LIST is a
 * capped `findMany` (REVIEW_PAGE). This is what keeps a popular gym's page O(1)
 * in review count instead of streaming every row to the server on each view.
 */
export async function getGymReviewData(gymId: string, viewerId?: string | null): Promise<GymReviewData> {
  const where = { gymId, deleted: false } as const;

  const [dist, agg, recommendedCount, verifiedCount, myRow, listRows] = await Promise.all([
    prisma.gymReview.groupBy({ by: ["overall"], where, _count: { _all: true } }),
    prisma.gymReview.aggregate({
      where,
      _count: { _all: true },
      _avg: { overall: true, coaching: true, facilities: true, atmosphere: true, cleanliness: true, value: true },
    }),
    prisma.gymReview.count({ where: { ...where, recommended: true } }),
    prisma.gymReview.count({ where: { ...where, verifiedMember: true } }),
    viewerId
      ? prisma.gymReview.findFirst({ where: { ...where, authorId: viewerId }, select: REVIEW_SELECT })
      : Promise.resolve(null),
    // Best-supported first: verified members, then most-helpful, then recent —
    // NOT newest-first, which rewards spam over signal. Own review excluded (it
    // renders separately). Capped.
    prisma.gymReview.findMany({
      where: viewerId ? { ...where, authorId: { not: viewerId } } : where,
      orderBy: [{ verifiedMember: "desc" }, { helpfulCount: "desc" }, { createdAt: "desc" }],
      take: REVIEW_PAGE,
      select: REVIEW_SELECT,
    }),
  ]);

  // Viewer's helpful votes for the rows actually shown — one read, bounded.
  const shownIds = [...listRows.map((r) => r.id), ...(myRow ? [myRow.id] : [])];
  let myVotes = new Set<string>();
  if (viewerId && shownIds.length) {
    const votes = await prisma.gymReviewVote.findMany({
      where: { userId: viewerId, reviewId: { in: shownIds } },
      select: { reviewId: true },
    });
    myVotes = new Set(votes.map((v) => v.reviewId));
  }

  const toDTO = (r: typeof listRows[number], isMine: boolean): ReviewDTO => ({
    id: r.id,
    authorId: r.authorId,
    authorName: r.author.name ?? "Anonymous",
    authorUsername: r.author.username,
    authorImage: r.author.image,
    overall: r.overall,
    categories: { coaching: r.coaching, facilities: r.facilities, atmosphere: r.atmosphere, cleanliness: r.cleanliness, value: r.value },
    title: r.title,
    body: r.body,
    recommended: r.recommended,
    skillLevel: r.skillLevel,
    disciplines: r.disciplines,
    verifiedMember: r.verifiedMember,
    authorRole: r.authorRole,
    helpfulCount: r.helpfulCount,
    votedHelpful: myVotes.has(r.id),
    edited: r.edited,
    createdAt: r.createdAt.toISOString(),
    isMine,
  });

  const count = agg._count._all;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, count: dist.find((d) => d.overall === star)?._count._all ?? 0 }));
  const categoryAverages = Object.fromEntries(CATEGORIES.map((c) => [c, round1(agg._avg[c])])) as Record<Category, number | null>;

  return {
    summary: {
      count,
      average: round1(agg._avg.overall) ?? 0,
      recommendedPct: count ? Math.round((recommendedCount / count) * 100) : 0,
      distribution,
      categoryAverages,
      verifiedCount,
    },
    reviews: listRows.map((r) => toDTO(r, false)),
    myReview: myRow ? toDTO(myRow, true) : null,
  };
}

const REVIEW_SELECT = {
  id: true, authorId: true, overall: true,
  coaching: true, facilities: true, atmosphere: true, cleanliness: true, value: true,
  title: true, body: true, recommended: true, skillLevel: true, disciplines: true,
  verifiedMember: true, authorRole: true, helpfulCount: true, edited: true, createdAt: true,
  author: { select: { name: true, username: true, image: true } },
} as const;

/** Recompute a gym's denormalised rating from its live reviews. Runs inside the
 *  same transaction as the write that triggered it, so the aggregate can never
 *  drift from the rows. */
async function recomputeRating(tx: Prisma.TransactionClient, gymId: string) {
  const agg = await tx.gymReview.aggregate({
    where: { gymId, deleted: false },
    _avg: { overall: true },
    _count: { _all: true },
  });
  await tx.gym.update({
    where: { id: gymId },
    data: {
      ratingCount: agg._count._all,
      ratingAvg: agg._count._all > 0 ? Math.round((agg._avg.overall ?? 0) * 10) / 10 : null,
    },
  });
}

/** Create or update the viewer's single review of a gym. Snapshots their
 *  membership as the trust signal and recomputes the aggregate atomically. */
export async function submitGymReview(userId: string, gymId: string, input: ReviewInput) {
  const overall = clampStar(input.overall);
  if (!overall) throw new Error("Pick an overall rating from 1 to 5 stars.");
  const body = input.body.trim();
  if (body.length < 3) throw new Error("Tell other fighters a little about the gym.");
  if (body.length > 4000) throw new Error("Keep your review under 4000 characters.");
  const skillLevel = input.skillLevel && (SKILL_LEVELS as readonly string[]).includes(input.skillLevel) ? input.skillLevel : null;

  // Trust snapshot — who was this author, to this gym, at review time.
  const membership = await prisma.gymMember.findUnique({
    where: { gymId_userId: { gymId, userId } },
    select: { role: true },
  });

  const data = {
    overall,
    coaching: clampStar(input.coaching),
    facilities: clampStar(input.facilities),
    atmosphere: clampStar(input.atmosphere),
    cleanliness: clampStar(input.cleanliness),
    value: clampStar(input.value),
    title: input.title?.trim().slice(0, 120) || null,
    body,
    recommended: !!input.recommended,
    skillLevel,
    disciplines: (input.disciplines ?? []).slice(0, 12),
    verifiedMember: !!membership,
    authorRole: membership?.role ?? null,
  };

  // Upsert, NOT read-then-write. A double-clicked submit fires two requests that
  // both read "no existing review" and both `create`, and the second hit the
  // @@unique([gymId, authorId]) constraint — surfacing a raw Prisma P2002 (which
  // names the model and columns) straight to the client, AND failing the submit
  // that had in fact just saved. upsert resolves the conflict in the database:
  // whichever write lands second becomes the update. `edited` is only set on the
  // update branch, so a first-time review is not born already flagged as edited.
  // `existed` decides whether this is a NEW review or an edit, and it must be read
  // INSIDE the transaction that upserts — reading it after would race a concurrent
  // submit and mislabel the notification.
  let existed = false;
  await prisma.$transaction(async (tx) => {
    const prior = await tx.gymReview.findUnique({
      where: { gymId_authorId: { gymId, authorId: userId } },
      select: { id: true, deleted: true },
    });
    existed = !!prior && !prior.deleted;
    await tx.gymReview.upsert({
      where: { gymId_authorId: { gymId, authorId: userId } },
      create: { ...data, gymId, authorId: userId },
      update: { ...data, edited: true, deleted: false },
    });
    await recomputeRating(tx, gymId);
  });

  // Fan out AFTER the transaction commits. Inside it, a slow push would hold the
  // review's row lock open, and a failure would roll back content the user wrote.
  // notifyGymReview never throws.
  await notifyGymReview(gymId, userId, existed ? "edited" : "created");
}

/** Soft-delete the viewer's own review and refresh the aggregate. */
export async function deleteGymReview(userId: string, gymId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.gymReview.updateMany({
      where: { gymId, authorId: userId, deleted: false },
      data: { deleted: true },
    });
    await recomputeRating(tx, gymId);
  });
}

/** Toggle a helpful vote. Returns the new count and whether the viewer's vote is
 *  now on. A user cannot make their own review "helpful". */
export async function toggleHelpful(userId: string, reviewId: string): Promise<{ helpfulCount: number; voted: boolean }> {
  return prisma.$transaction(async (tx) => {
    const review = await tx.gymReview.findUnique({ where: { id: reviewId }, select: { authorId: true, deleted: true } });
    if (!review || review.deleted) throw new Error("Review not found.");
    if (review.authorId === userId) throw new Error("You can't vote on your own review.");

    const existing = await tx.gymReviewVote.findUnique({ where: { reviewId_userId: { reviewId, userId } } });
    if (existing) {
      await tx.gymReviewVote.delete({ where: { reviewId_userId: { reviewId, userId } } });
    } else {
      await tx.gymReviewVote.create({ data: { reviewId, userId } });
    }
    const helpfulCount = await tx.gymReviewVote.count({ where: { reviewId } });
    await tx.gymReview.update({ where: { id: reviewId }, data: { helpfulCount } });
    return { helpfulCount, voted: !existing };
  });
}
