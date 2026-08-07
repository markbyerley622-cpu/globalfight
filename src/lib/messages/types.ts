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
