import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";
import {
  MAX_MESSAGE_LENGTH,
  type ConversationSummary,
  type ConversationView,
  type DmMessage,
  type DmPerson,
} from "@/lib/messages/types";

export * from "@/lib/messages/types";

// ════════════════════════════════════════════════════════════════════════════
//  Direct messages — the service layer. EVERY ownership check lives here.
//
//  Per CLAUDE.md rule 2, membership is verified in this module rather than in
//  the route, so it holds for every caller of these functions rather than for
//  the one HTTP path someone remembered to guard. A conversation id is a cuid
//  and therefore guessable-ish; nothing below trusts one.
//
//  Rule 6 applies too: a non-member asking for a conversation gets the SAME
//  answer as someone asking for one that does not exist. If a non-member could
//  tell "forbidden" from "not found", the endpoint would confirm that two
//  specific people are talking — which is the private fact DMs exist to keep.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The identity of a conversation: the two user ids, sorted.
 *
 * Sorting is what makes it orientation-independent — A opening a thread with B
 * and B opening one with A must land on the SAME row. Combined with the @unique
 * on pairKey this is enforced by Postgres, so two people pressing "message" at
 * the same moment cannot create two threads (rule 4: never check-then-create).
 */
export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

const MEMBER_USER = {
  select: { id: true, username: true, name: true, image: true },
} as const;

const toPerson = (u: { id: string; username: string | null; name: string | null; image: string | null }): DmPerson => ({
  id: u.id,
  username: u.username,
  // Never the raw `name` — see lib/display-name.
  name: publicDisplayName(u),
  image: u.image,
});

/**
 * Open (or reuse) the conversation between the viewer and another user.
 *
 * Self-messaging is refused: a thread with yourself has no second party, and
 * pairKeyFor(x, x) would collapse to a single id, which the unique index would
 * then treat as one shared row.
 */
export async function openConversation(viewerId: string, otherUserId: string): Promise<string> {
  if (viewerId === otherUserId) throw new Error("You can't message yourself.");

  const other = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
  if (!other) throw new Error("That person no longer exists.");

  const pairKey = pairKeyFor(viewerId, otherUserId);

  // Upsert, not find-then-create: two simultaneous opens race into a P2002 that
  // both fails the write AND leaks the constraint name to the client.
  const convo = await prisma.conversation.upsert({
    where: { pairKey },
    update: {},
    create: {
      pairKey,
      members: { create: [{ userId: viewerId }, { userId: otherUserId }] },
    },
    select: { id: true },
  });

  // Re-opening an archived thread un-archives it for the person opening it only.
  await prisma.conversationMember.updateMany({
    where: { conversationId: convo.id, userId: viewerId },
    data: { archivedAt: null },
  });

  return convo.id;
}

/** Membership check. Returns the other participant, or null if not a member. */
async function requireMember(conversationId: string, viewerId: string) {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId: viewerId } } },
    select: { id: true, members: { select: { userId: true, user: MEMBER_USER } } },
  });
  if (!convo) return null;
  const other = convo.members.find((m) => m.userId !== viewerId);
  return { id: convo.id, other: other ? toPerson(other.user) : null };
}

/** The viewer's inbox, newest activity first. Owner-scoped by construction. */
export async function listConversations(viewerId: string, limit = 50): Promise<ConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    where: { members: { some: { userId: viewerId, archivedAt: null } } },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      lastMessageAt: true,
      members: { select: { userId: true, lastReadAt: true, user: MEMBER_USER } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true, senderId: true },
      },
    },
  });

  // Unread counts for every thread in ONE query rather than one per row — an
  // inbox of 50 threads must not be 50 round-trips.
  const mine = new Map(
    rows.map((r) => [r.id, r.members.find((m) => m.userId === viewerId)?.lastReadAt ?? null]),
  );
  const counts = await prisma.directMessage.groupBy({
    by: ["conversationId"],
    where: {
      conversationId: { in: rows.map((r) => r.id) },
      senderId: { not: viewerId },
      OR: rows.map((r) => ({
        conversationId: r.id,
        // A never-read thread has every inbound message unread.
        createdAt: mine.get(r.id) ? { gt: mine.get(r.id)! } : undefined,
      })),
    },
    _count: { _all: true },
  });
  const unreadBy = new Map(counts.map((c) => [c.conversationId, c._count._all]));

  return rows.flatMap((r) => {
    const other = r.members.find((m) => m.userId !== viewerId);
    // A thread whose other member is gone is not renderable as a conversation.
    if (!other) return [];
    const last = r.messages[0];
    return [{
      id: r.id,
      withUser: toPerson(other.user),
      lastMessageAt: r.lastMessageAt.toISOString(),
      unread: unreadBy.get(r.id) ?? 0,
      lastMessage: last
        ? { body: last.body, at: last.createdAt.toISOString(), fromMe: last.senderId === viewerId }
        : null,
    }];
  });
}

/** Total unread across the inbox — what the header badge renders. */
export async function unreadMessageCount(viewerId: string): Promise<number> {
  const members = await prisma.conversationMember.findMany({
    where: { userId: viewerId, archivedAt: null },
    select: { conversationId: true, lastReadAt: true },
  });
  if (members.length === 0) return 0;

  return prisma.directMessage.count({
    where: {
      senderId: { not: viewerId },
      OR: members.map((m) => ({
        conversationId: m.conversationId,
        createdAt: m.lastReadAt ? { gt: m.lastReadAt } : undefined,
      })),
    },
  });
}

/**
 * One thread. Returns null for a non-member AND for a missing id — the caller
 * turns both into 404 so the endpoint is not an existence oracle.
 */
export async function getConversation(
  conversationId: string,
  viewerId: string,
  limit = 100,
): Promise<ConversationView | null> {
  const member = await requireMember(conversationId, viewerId);
  if (!member) return null;

  const rows = await prisma.directMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, body: true, createdAt: true, senderId: true },
  });

  return {
    id: member.id,
    withUser: member.other,
    // Oldest-first for rendering; the query is newest-first so `take` keeps the
    // most RECENT window rather than the first 100 messages ever sent.
    messages: rows.reverse().map((m) => ({
      id: m.id,
      body: m.body,
      at: m.createdAt.toISOString(),
      senderId: m.senderId,
      fromMe: m.senderId === viewerId,
    })),
  };
}

/** Send. Throws a human-readable message the route can pass through safely. */
export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<DmMessage> {
  const text = body.trim();
  if (!text) throw new Error("Write something first.");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const member = await requireMember(conversationId, senderId);
  if (!member) throw new Error("This conversation is not available.");

  // The message and the thread's ordering key move together, so an inbox can
  // never sort by a timestamp that disagrees with the message it is showing.
  const [message] = await prisma.$transaction([
    prisma.directMessage.create({
      data: { conversationId, senderId, body: text },
      select: { id: true, body: true, createdAt: true, senderId: true },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
    // Sending is reading: your own message must not make your thread unread.
    prisma.conversationMember.updateMany({
      where: { conversationId, userId: senderId },
      data: { lastReadAt: new Date(), archivedAt: null },
    }),
  ]);

  return {
    id: message.id,
    body: message.body,
    at: message.createdAt.toISOString(),
    senderId: message.senderId,
    fromMe: true,
  };
}

/** Move the viewer's read watermark to now. Idempotent. */
export async function markRead(conversationId: string, viewerId: string): Promise<void> {
  // updateMany, not update: it is a no-op for a non-member instead of throwing
  // a P2025 that would confirm the conversation exists.
  await prisma.conversationMember.updateMany({
    where: { conversationId, userId: viewerId },
    data: { lastReadAt: new Date() },
  });
}
