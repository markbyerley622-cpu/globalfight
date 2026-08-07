import type { PresenceDto } from "@/lib/presence/policy";
// Client-safe DM contract: the shapes and limits both sides need.
//
// Separate from repo.ts because that module is `server-only` — importing it
// from a client component throws at build time. The composer needs the length
// limit and the thread needs the message shape, so they live here and the
// server module imports them, rather than the client reaching into the server.

/** The maximum a single message can carry. Long enough for a real argument. */
export const MAX_MESSAGE_LENGTH = 4000;

export interface DmPerson {
  id: string;
  username: string | null;
  /** Already passed through publicDisplayName — never a raw User.name. */
  name: string;
  image: string | null;
  /** Staff-approved professional identity — drives the badge. */
  verified: boolean;
  /**
   * Presence, already FILTERED for the viewer looking at it.
   *
   * Built by `presenceDtoFor`, never assembled here: a hidden user's timestamp
   * is absent from this object entirely rather than present-and-ignored, so
   * there is nothing for a browser to read that the viewer was not entitled to.
   */
  presence: PresenceDto;
}

export interface DmMessage {
  id: string;
  body: string;
  at: string;
  senderId: string;
  fromMe: boolean;
}

export interface ConversationSummary {
  id: string;
  /** The OTHER person. A 1:1 inbox is a list of people, not of threads. */
  withUser: DmPerson;
  lastMessage: { body: string; at: string; fromMe: boolean } | null;
  unread: number;
  lastMessageAt: string;
  /**
   * Is the other person composing, right now, in THIS thread?
   *
   * In the inbox as well as in the thread, because "someone is replying to you"
   * is the single most useful thing an inbox can tell you and it is the reason
   * to open one thread over another.
   */
  otherTyping: boolean;
  /**
   * Their read watermark — drives the receipt on the last message you sent.
   *
   * NULL when either side has read receipts switched off. The gate is applied
   * server-side in the repo, so the watermark of somebody who opted out never
   * reaches the client to be "hidden" by a component.
   */
  otherReadAt: string | null;
  /** Their delivery watermark. See DeliveryState in lib/presence/derive. */
  otherDeliveredAt: string | null;
}

/**
 * Inbox order.
 *
 * ── Why not simply "most recent first" ────────────────────────────────────
 * Recency answers "what happened last", which is not what somebody opening an
 * inbox wants — they want "what needs me". A thread where the other person is
 * typing RIGHT NOW is the most urgent thing on the screen and can easily sit
 * fourth by timestamp, below three conversations that are finished.
 *
 * Typing → unread → recent, and the tiebreaker within every band is still
 * recency, so the ordering is total and stable. Shared by the server and any
 * client that re-sorts after a poll, so the list cannot reorder itself
 * differently between a fetch and a re-render.
 */
export function byInboxPriority(a: ConversationSummary, b: ConversationSummary): number {
  if (a.otherTyping !== b.otherTyping) return a.otherTyping ? -1 : 1;
  const unreadA = a.unread > 0 ? 0 : 1;
  const unreadB = b.unread > 0 ? 0 : 1;
  if (unreadA !== unreadB) return unreadA - unreadB;
  return b.lastMessageAt.localeCompare(a.lastMessageAt);
}

export interface ConversationView {
  id: string;
  withUser: DmPerson | null;
  messages: DmMessage[];
  /**
   * Is the other person composing right now?
   *
   * Derived from a TIMESTAMP that the server compares against a short TTL, never
   * from a stored boolean — see ConversationMember.typingAt. That means a reader
   * who types a word and then closes the tab, loses signal or force-quits can
   * never leave "typing…" stuck on the other side: the fact simply stops being
   * recent, with nothing to clean up.
   */
  otherTyping: boolean;

  /**
   * When the other person last read this thread, ISO — or null if never.
   *
   * ── Why a TIMESTAMP and not a per-message `read` flag ─────────────────────
   * Reading is a watermark, not a property of each message: `lastReadAt` already
   * exists on ConversationMember and is what the unread counts are computed
   * from. Exposing the watermark lets the client mark every message at or before
   * it as read with no extra column, no per-message write, and — crucially — no
   * way for the receipt to disagree with the unread badge, because both are
   * derived from the same instant.
   *
   * Only the OTHER member's watermark is exposed, and only to a member of the
   * thread. Your own is not interesting to you, and neither is visible to
   * anybody outside the conversation.
   */
  otherReadAt: string | null;

  /**
   * Their DELIVERY watermark — the last time their client fetched this thread.
   *
   * Separate from `otherReadAt` on purpose: their device having the message and
   * their eyes having been on it are different facts, and collapsing them is
   * what turns ✓✓ into decoration. See DeliveryState in lib/presence/derive.
   */
  otherDeliveredAt: string | null;

  /**
   * Either side has read receipts switched off.
   *
   * Surfaced so the thread can EXPLAIN the missing tick. Without it the ticks
   * would simply stop at Delivered forever and read as a bug — the user would
   * conclude the other person never opens their messages, which is a worse
   * misunderstanding than the one the privacy setting was protecting against.
   */
  receiptsHidden: boolean;
}

/**
 * How long a typing ping stays believable.
 *
 * Must exceed the client's own ping interval (TYPING_PING_MS) or the indicator
 * flickers between pings; must stay short enough that a dropped connection
 * clears within a beat. 2× the ping rate is the usual ratio.
 */
export const TYPING_TTL_MS = 7000;

/** How often a composing client re-asserts that it is still typing. */
export const TYPING_PING_MS = 3000;
