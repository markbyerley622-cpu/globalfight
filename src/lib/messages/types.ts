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
}
