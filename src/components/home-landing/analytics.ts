"use client";

import { track } from "@/lib/analytics-client";

/**
 * The landing page's instrumentation, over the app's own `track()` — the same
 * first-party, cookieless POST to /api/track that the rest of the product uses.
 * No second analytics provider is installed and none is needed.
 *
 * Two properties are enforced here rather than left to each call site:
 *
 *  · **Fire once.** A scroll-driven page will re-enter the same stage a dozen
 *    times as a reader moves up and down; sending a row for each one would make
 *    "stages viewed" a measure of fidgeting. Every name+id fires at most once
 *    per page view.
 *
 *  · **No free-form payload.** `id` is always a literal from content.ts — a
 *    stage id, a window id, a CTA position — never anything a visitor typed,
 *    chose or owns. There is no path by which personal data reaches the table
 *    through this module.
 */

const seen = new Set<string>();

export type LandingEvent =
  | "home_landing_view"
  | "home_primary_cta_clicked"
  | "home_secondary_cta_clicked"
  | "home_story_stage_viewed"
  | "home_product_preview_clicked"
  | "home_signup_started";

export function trackLanding(name: LandingEvent, id?: string): void {
  const key = id ? `${name}:${id}` : name;
  if (seen.has(key)) return;
  seen.add(key);
  track(name, id ? { id } : undefined, "/");
}
