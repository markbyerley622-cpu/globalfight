// Combat Feed — shared types.
export type FeedTopic = "ufc" | "boxing" | "muaythai" | "bjj" | "kickboxing" | "one";

export interface FeedVideo {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  description?: string;
  publishedAt: string;
  viewCount?: number;
  duration?: string; // ISO-8601 (from Data API) when available
  durationSeconds?: number; // used by mock data
  topic?: FeedTopic | null;
  tags?: string[];
  addedAt?: number; // when it entered the catalog
}

export interface FeedFilterOptions {
  topics?: string[];
  hide?: string[];
  minSeconds?: number;
  q?: string;
  intent?: string;
}

export interface SelectOptions extends FeedFilterOptions {
  cid?: string;
  sort?: "smart" | "top" | "new";
  limit?: number;
  offset?: number;
  opener?: boolean; // first batch of a session — rotate which strong clip leads
  excludeOpeners?: string[]; // recent opening video ids to avoid re-opening on
}
