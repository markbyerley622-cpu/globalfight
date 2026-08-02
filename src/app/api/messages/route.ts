import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { listConversations, openConversation, unreadMessageCount } from "@/lib/messages/repo";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/** The viewer's inbox. Owner-scoped in the service layer, never by the caller. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your messages." }, { status: 401 });

  const [conversations, unread] = await Promise.all([
    listConversations(user.id),
    unreadMessageCount(user.id),
  ]);
  return NextResponse.json({ conversations, unread });
}

/**
 * Open a conversation with someone, by handle. Idempotent: messaging the same
 * person twice returns the SAME thread rather than a second one (the pairKey
 * unique index enforces that even under a simultaneous open from both sides).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to send a message." }, { status: 401 });

  const limited = await enforceLimit(req, "conversation-open", POLICY.conversationOpen, user.id);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { username?: string };
  const username = body.username?.trim();
  if (!username) return NextResponse.json({ error: "Who do you want to message?" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "No such person." }, { status: 404 });

  try {
    const conversationId = await openConversation(user.id, target.id);
    return NextResponse.json({ conversationId });
  } catch (err) {
    // The service layer throws human-readable strings on purpose; raw Prisma
    // errors never reach here because the write is an upsert (CLAUDE.md rule 5).
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not open that conversation." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
