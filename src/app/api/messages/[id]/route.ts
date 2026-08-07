import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getConversation, sendMessage, markRead } from "@/lib/messages/repo";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/**
 * One thread.
 *
 * A non-member gets 404, identical to a conversation that does not exist. If
 * the two answers differed, anyone could confirm that two specific people are
 * talking by probing ids — the private fact DMs exist to protect (CLAUDE.md
 * rule 6, the same treatment claim evidence gets).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to read your messages." }, { status: 401 });

  const { id } = await params;
  const convo = await getConversation(id, user.id);
  if (!convo) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Opening a thread is reading it. Done here rather than on the client so the
  // badge clears even if the tab is closed before any effect runs.
  await markRead(id, user.id);
  return NextResponse.json(convo);
}

/** Send a message into this thread. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to send a message." }, { status: 401 });

  const limited = await enforceLimit(req, "direct-message", POLICY.directMessage, user.id);
  if (limited) return limited;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { body?: string; entities?: unknown };

  try {
    // `entities` is passed through unvalidated: resolveDraftEntities in the
    // service layer is the ONE place that checks spans against the text and
    // handles against the user table (CLAUDE.md rule 2).
    const message = await sendMessage(id, user.id, body.body ?? "", body.entities);
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not send that message." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
