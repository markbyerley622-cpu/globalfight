import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivity } from "@/lib/activity/read";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/**
 * A member's activity feed, page by page.
 *
 * PUBLIC by design and by disclosure: every row here describes something that
 * already happened in public — a pick on a public bout, a follow, a post in a
 * public thread. The emitters refuse to write anything private (a battle-room
 * post never emits; see activity/emit), so this endpoint cannot leak what the
 * profile itself does not already show. The Privacy Notice says so explicitly.
 *
 * Access-control walk (CLAUDE.md):
 *  1. No mutation, so no 401 gate — but it IS rate-limited, because it is an
 *     unauthenticated, cursor-paginated read that a script could walk.
 *  5. A bad cursor is treated as "start from the beginning" rather than raising,
 *     so a tampered query string cannot produce a 500 or an ORM message.
 *  8. GET only; nothing here changes state.
 */
export async function GET(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  const limited = await enforceLimit(req, "activity-feed", POLICY.search);
  if (limited) return limited;

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  // 404 rather than an empty page: an unknown handle is not an empty feed, and
  // conflating them makes a typo look like a real but silent profile.
  if (!user) return NextResponse.json({ error: "No such user." }, { status: 404 });

  const url = new URL(req.url);
  const page = await getActivity(user.id, {
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit")) || undefined,
  });

  return NextResponse.json(page);
}

export const dynamic = "force-dynamic";
