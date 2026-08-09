// ════════════════════════════════════════════════════════════════════════════
//  Feedback vocabulary — the CLIENT-SAFE half.
//
//  Split out for the same reason lib/identity-verification-shared exists: the
//  submission form and the board's filter chips need the categories, the
//  statuses and the length limits, and importing them from the service would
//  drag Prisma and `server-only` into the browser bundle.
//
//  It also means the limits are enforced in ONE place and checked in two: the
//  form counts characters against these constants, and the service validates
//  against the same constants before writing. A client-side limit alone is a
//  suggestion.
// ════════════════════════════════════════════════════════════════════════════

export const CATEGORIES = ["IDEA", "FEATURE", "IMPROVEMENT", "BUG"] as const;
export type FeedbackCategory = (typeof CATEGORIES)[number];

export const STATUSES = ["OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "DECLINED"] as const;
export type FeedbackStatus = (typeof STATUSES)[number];

export const isCategory = (v: unknown): v is FeedbackCategory =>
  typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

export const isStatus = (v: unknown): v is FeedbackStatus =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export const TITLE_MIN = 4;
export const TITLE_MAX = 120;
export const BODY_MIN = 10;
export const BODY_MAX = 4000;

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  IDEA: "Idea",
  FEATURE: "Feature",
  IMPROVEMENT: "Improvement",
  BUG: "Bug",
};

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  OPEN: "Open",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  DECLINED: "Declined",
};

/**
 * Status → badge tone.
 *
 * Every status also carries its LABEL wherever this is used — the colour is a
 * second signal, never the only one, so the board stays readable to anyone who
 * does not distinguish the two greens.
 */
export const STATUS_TONE: Record<FeedbackStatus, "neutral" | "volt" | "gold" | "red" | "outline"> = {
  OPEN: "outline",
  PLANNED: "gold",
  IN_PROGRESS: "volt",
  COMPLETED: "volt",
  DECLINED: "neutral",
};
