import "server-only";
import { prisma } from "@/lib/db";
import { openConversation, pairKeyFor } from "@/lib/messages/repo";
import { publicDisplayName } from "@/lib/display-name";

// ════════════════════════════════════════════════════════════════════════════
//  A challenge is a MESSAGE.
//
//  ── Why this module exists ────────────────────────────────────────────────
//  A challenge used to be an object with no home. It created a Battle row, sent
//  a notification, and left the two people with nowhere to go: the notification
//  opened a fight page, the battle room did not exist until both sides had
//  picked, and the person who had been called out had no way to reply to the
//  person who called them out.
//
//  Delivering it into a conversation closes that loop. The challenge, the
//  argument about it, the picks, the event and the result all live in the same
//  thread with the same person, which is what makes it feel like a relationship
//  rather than a one-off transaction.
//
//  ── Why the DM is opened by the CHALLENGER's action, not lazily ───────────
//  Creating the conversation at challenge time is what makes the notification
//  deep-link possible: it can only say "open this conversation" if one exists.
//  A lazily-created thread would mean the notification pointing at a generic
//  inbox — the dead end this was built to remove.
// ════════════════════════════════════════════════════════════════════════════

/** How a challenge reads in an inbox preview, a push, and to a screen reader. */
function challengeSentence(who: string, red: string, blue: string): string {
  return `${who} challenged you on ${red} vs ${blue}.`;
}

export interface DeliveredChallenge {
  conversationId: string;
  messageId: string;
}

/**
 * Put the challenge in front of the person, in a conversation.
 *
 * Best-effort by contract: the BATTLE is already committed by the time this
 * runs, so a failure here must never propagate. A challenge that exists without
 * its card is recoverable — the recipient still gets a notification and the
 * fight page still works — whereas a challenge rolled back because a message
 * failed to insert is a lost interaction the user thinks succeeded.
 */
export async function deliverChallengeToDm(
  challengerId: string,
  targetId: string,
  battleId: string,
  fightId: string,
): Promise<DeliveredChallenge | null> {
  try {
    const [fight, challenger] = await Promise.all([
      prisma.fight.findUnique({
        where: { id: fightId },
        select: { red: { select: { name: true } }, blue: { select: { name: true } } },
      }),
      prisma.user.findUnique({
        where: { id: challengerId },
        select: { name: true, username: true },
      }),
    ]);
    if (!fight) return null;

    const conversationId = await openConversation(challengerId, targetId);
    const body = challengeSentence(
      challenger ? publicDisplayName(challenger) : "Someone",
      fight.red.name,
      fight.blue.name,
    );

    // ── One card per battle, enforced by a guarded read inside the write ──
    // A challenger who taps twice, or a retry after a timeout, must not stack
    // two identical cards in the thread. Checked and inserted in ONE
    // transaction so two concurrent taps cannot both pass the check.
    const message = await prisma.$transaction(async (tx) => {
      const existing = await tx.directMessage.findFirst({
        where: { conversationId, battleId, kind: "CHALLENGE" },
        select: { id: true },
      });
      if (existing) return existing;

      const created = await tx.directMessage.create({
        data: { conversationId, senderId: challengerId, body, kind: "CHALLENGE", battleId },
        select: { id: true },
      });
      // The thread's ordering key moves with it, or the inbox would sort this
      // conversation by a timestamp older than the card it is showing.
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });
      // Sending is reading: the challenger's own card must not make their own
      // thread unread. Same rule as sendMessage.
      await tx.conversationMember.updateMany({
        where: { conversationId, userId: challengerId },
        data: { lastReadAt: new Date(), archivedAt: null },
      });
      // The RECIPIENT's copy is un-archived too: a challenge into a thread they
      // had previously archived must reappear, or it is delivered into a
      // folder they will never look in.
      await tx.conversationMember.updateMany({
        where: { conversationId, userId: targetId },
        data: { archivedAt: null },
      });
      return created;
    });

    return { conversationId, messageId: message.id };
  } catch {
    // See the contract above — the battle is already committed.
    return null;
  }
}

/** The conversation these two share, if one exists. Used for deep links. */
export async function existingConversationId(a: string, b: string): Promise<string | null> {
  const convo = await prisma.conversation.findUnique({
    where: { pairKey: pairKeyFor(a, b) },
    select: { id: true },
  });
  return convo?.id ?? null;
}
