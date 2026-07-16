// Time-bucketing for the event-discovery timeline (ported from the globalfight
// skeleton's domain selectors, adapted to the Prisma Event shape). Pure + typed
// generically so it works on any {date, status} row.

export type TimeBucket = "live" | "coming-up" | "next-7-days" | "later" | "completed";

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  live: "Live now",
  "coming-up": "Coming up",
  "next-7-days": "Next 7 days",
  later: "Later",
  completed: "Recently completed",
};

const ORDER: TimeBucket[] = ["live", "coming-up", "next-7-days", "later", "completed"];

function bucketFor(date: Date, status: string, now: Date): TimeBucket {
  if (status === "LIVE") return "live";
  if (status === "COMPLETED") return "completed";
  const diff = date.getTime() - now.getTime();
  if (diff < 0) return "completed";
  const hours = diff / 3_600_000;
  if (hours <= 24) return "coming-up";
  if (hours <= 24 * 7) return "next-7-days";
  return "later";
}

export interface EventGroup<T> {
  bucket: TimeBucket;
  label: string;
  events: T[];
}

/** Group + sort events into discovery buckets; empty buckets are dropped. */
export function groupEventsByTime<T extends { date: Date | string; status: string }>(
  events: T[],
  now: Date = new Date(),
): EventGroup<T>[] {
  const map = new Map<TimeBucket, T[]>();
  for (const e of events) {
    const b = bucketFor(new Date(e.date), e.status, now);
    const list = map.get(b) ?? [];
    list.push(e);
    map.set(b, list);
  }
  return ORDER.map((bucket) => {
    const list = (map.get(bucket) ?? []).sort((a, b) => {
      const dir = bucket === "completed" ? -1 : 1; // completed: most recent first
      return dir * (new Date(a.date).getTime() - new Date(b.date).getTime());
    });
    return { bucket, label: TIME_BUCKET_LABELS[bucket], events: list };
  }).filter((g) => g.events.length > 0);
}
