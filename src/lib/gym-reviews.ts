import "server-only";
import { prisma } from "@/lib/db";
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

/** Everything a gym page needs to render reviews — in three batched reads
 *  (reviews + this viewer's helpful votes), regardless of review count. */
export async function getGymReviewData(gymId: string, viewerId?: string | null): Promise<GymReviewData> {
  const rows = await prisma.gymReview.findMany({
    where: { gymId, deleted: false },
    // Best-supported first: verified members, then most-helpful, then recent.
    // NOT newest-first, which rewards review spam over signal.
    orderBy: [{ verifiedMember: "desc" }, { helpfulCount: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, authorId: true, overall: true,
      coaching: true, facilities: true, atmosphere: true, cleanliness: true, value: true,
      title: true, body: true, recommended: true, skillLevel: true, disciplines: true,
      verifiedMember: true, authorRole: true, helpfulCount: true, edited: true, createdAt: true,
      author: { select: { name: true, username: true, image: true } },
    },
  });

  // Which of these did the viewer mark helpful — ONE read for all of them.
  let myVotes = new Set<string>();
  if (viewerId && rows.length) {
    const votes = await prisma.gymReviewVote.findMany({
      where: { userId: viewerId, reviewId: { in: rows.map((r) => r.id) } },
      select: { reviewId: true },
    });
    myVotes = new Set(votes.map((v) => v.reviewId));
  }

  const toDTO = (r: (typeof rows)[number]): ReviewDTO => ({
    id: r.id,
    authorId: r.authorId,
    authorName: r.author.name ?? "Anonymous",
    authorUsername: r.author.username,
    authorImage: r.author.image,
    overall: r.overall,
    categories: {
      coaching: r.coaching, facilities: r.facilities, atmosphere: r.atmosphere,
      cleanliness: r.cleanliness, value: r.value,
    },
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
    isMine: !!viewerId && r.authorId === viewerId,
  });

  const reviews = rows.map(toDTO);

  // Summary — computed from the rows already in hand, no extra query.
  const count = reviews.length;
  const average = count ? Math.round((reviews.reduce((s, r) => s + r.overall, 0) / count) * 10) / 10 : 0;
  const recommendedPct = count ? Math.round((reviews.filter((r) => r.recommended).length / count) * 100) : 0;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.filter((r) => r.overall === star).length }));
  const categoryAverages = Object.fromEntries(
    CATEGORIES.map((c) => {
      const vals = reviews.map((r) => r.categories[c]).filter((v): v is number => v != null);
      return [c, vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null];
    }),
  ) as Record<Category, number | null>;
  const verifiedCount = reviews.filter((r) => r.verifiedMember).length;

  return {
    summary: { count, average, recommendedPct, distribution, categoryAverages, verifiedCount },
    reviews: reviews.filter((r) => !r.isMine),
    myReview: reviews.find((r) => r.isMine) ?? null,
  };
}

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

  await prisma.$transaction(async (tx) => {
    const existing = await tx.gymReview.findUnique({
      where: { gymId_authorId: { gymId, authorId: userId } },
      select: { id: true },
    });
    if (existing) {
      await tx.gymReview.update({
        where: { gymId_authorId: { gymId, authorId: userId } },
        data: { ...data, edited: true, deleted: false },
      });
    } else {
      await tx.gymReview.create({ data: { ...data, gymId, authorId: userId } });
    }
    await recomputeRating(tx, gymId);
  });
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
