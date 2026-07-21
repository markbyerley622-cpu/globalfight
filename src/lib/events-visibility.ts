import type { Prisma } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Draft visibility — ONE predicate.
//
//  A DRAFT event is a card an operator is still assembling. It must not appear
//  on any public surface, in search, in the sitemap, in a feed, in a calendar
//  export, or in onboarding's auto-follow.
//
//  Expressed once and spread into every public query, because "remember to add
//  `status: { not: DRAFT }`" is not a policy — it is a leak waiting for the next
//  query someone writes.
// ════════════════════════════════════════════════════════════════════════════

/** Spread into any public Event `where`. */
export const PUBLIC_EVENT = { status: { not: "DRAFT" } } satisfies Prisma.EventWhereInput;

/** True when this row may be shown to the public. */
export const isPublicEvent = (e: { status: string }): boolean => e.status !== "DRAFT";
