/**
 * Discussion service — INTERFACE + PLACEHOLDER implementation.
 *
 * Defines how the UI reads/sorts/filters event discussion and where posting
 * will eventually hook in. No real persistence, moderation queue, or auth here
 * — those are TODOs behind a stable contract.
 */
import type { DiscussionPost } from "@/lib/domain/types";
import { getPostsForEvent } from "@/lib/data/store";

export type DiscussionSort = "newest" | "most-discussed" | "most-respected";
export type DiscussionPhaseFilter = "all" | "pre-event" | "live" | "post-event";

export interface DiscussionQuery {
  eventId: string;
  /** Narrow to a single bout, if set. */
  fightId?: string;
  sort: DiscussionSort;
  phase: DiscussionPhaseFilter;
}

export interface DiscussionService {
  list(query: DiscussionQuery): Promise<DiscussionPost[]>;
  createPost(input: NewPostInput): Promise<DiscussionPost>;
}

export interface NewPostInput {
  eventId: string;
  fightId?: string;
  userId: string;
  body: string;
}

export function sortPosts(posts: DiscussionPost[], sort: DiscussionSort): DiscussionPost[] {
  const copy = [...posts];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "most-discussed":
      return copy.sort((a, b) => b.replyCount - a.replyCount);
    case "most-respected":
      return copy.sort((a, b) => b.author.reputation - a.author.reputation);
  }
}

export function filterPosts(posts: DiscussionPost[], query: DiscussionQuery): DiscussionPost[] {
  return posts.filter((p) => {
    if (p.moderation !== "visible") return false;
    if (query.fightId && p.fightId !== query.fightId) return false;
    if (query.phase !== "all" && p.phase !== query.phase) return false;
    return true;
  });
}

export const discussionService: DiscussionService = {
  async list(query) {
    const base = getPostsForEvent(query.eventId);
    return sortPosts(filterPosts(base, query), query.sort);
  },
  async createPost(_input) {
    // TODO: authenticate user, persist, run moderation, return created post.
    throw new Error("Not implemented: connect a persistence + moderation backend.");
  },
};
