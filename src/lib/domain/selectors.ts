/**
 * Domain selectors: pure functions that shape raw entities into the groupings
 * the UI needs. No React, no formatting — just data transforms so the same
 * logic is testable and reusable across every sport.
 */
import type { CardSegment, Event, EventStatus, Fight } from "./types";

export type TimeBucket = "live" | "coming-up" | "next-7-days" | "later" | "completed";

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  live: "Live now",
  "coming-up": "Coming up",
  "next-7-days": "Next 7 days",
  later: "Later",
  completed: "Recently completed",
};

/** Order in which discovery buckets are rendered. */
export const TIME_BUCKET_ORDER: TimeBucket[] = [
  "live",
  "coming-up",
  "next-7-days",
  "later",
  "completed",
];

/** Bucket a single event by its status + start time relative to `now`. */
export function bucketForEvent(event: Event, now: Date = new Date()): TimeBucket {
  if (event.status === "live") return "live";
  if (event.status === "completed") return "completed";
  if (event.status === "cancelled" || event.status === "postponed") {
    // Cancelled/postponed still surface under upcoming groupings by their date.
    return startBucket(event.startsAt, now);
  }
  return startBucket(event.startsAt, now);
}

function startBucket(startsAt: string, now: Date): TimeBucket {
  const diff = new Date(startsAt).getTime() - now.getTime();
  if (diff < 0) return "completed";
  const hours = diff / 3_600_000;
  if (hours <= 24) return "coming-up";
  if (hours <= 24 * 7) return "next-7-days";
  return "later";
}

export interface EventGroup {
  bucket: TimeBucket;
  label: string;
  events: Event[];
}

/** Group + sort events for the discovery screen. */
export function groupEventsByTime(events: Event[], now: Date = new Date()): EventGroup[] {
  const map = new Map<TimeBucket, Event[]>();
  for (const event of events) {
    const bucket = bucketForEvent(event, now);
    const list = map.get(bucket) ?? [];
    list.push(event);
    map.set(bucket, list);
  }
  return TIME_BUCKET_ORDER.map((bucket) => {
    const list = (map.get(bucket) ?? []).sort((a, b) => {
      const dir = bucket === "completed" ? -1 : 1; // completed: most recent first
      return dir * (new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    });
    return { bucket, label: TIME_BUCKET_LABELS[bucket], events: list };
  }).filter((group) => group.events.length > 0);
}

// --- Fight card grouping ----------------------------------------------------

export const CARD_SEGMENT_LABELS: Record<CardSegment, string> = {
  "main-event": "Main event",
  "main-card": "Main card",
  prelims: "Preliminary card",
  "early-prelims": "Early preliminary card",
};

export const CARD_SEGMENT_ORDER: CardSegment[] = [
  "main-event",
  "main-card",
  "prelims",
  "early-prelims",
];

export interface CardSection {
  segment: CardSegment;
  label: string;
  fights: Fight[];
}

/** Group a card's fights into ordered segments (top bout first within each). */
export function groupFightsBySegment(fights: Fight[]): CardSection[] {
  const map = new Map<CardSegment, Fight[]>();
  for (const fight of fights) {
    const list = map.get(fight.segment) ?? [];
    list.push(fight);
    map.set(fight.segment, list);
  }
  return CARD_SEGMENT_ORDER.map((segment) => ({
    segment,
    label: CARD_SEGMENT_LABELS[segment],
    fights: (map.get(segment) ?? []).sort((a, b) => b.boutOrder - a.boutOrder),
  })).filter((section) => section.fights.length > 0);
}

/** True when the event's lifecycle means predictions can still be cast. */
export function predictionsOpen(status: EventStatus): boolean {
  return status === "scheduled" || status === "announced" || status === "live";
}
