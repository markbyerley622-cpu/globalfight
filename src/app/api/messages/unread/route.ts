import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { unreadMessageCount } from "@/lib/messages/repo";

/**
 * Just the badge number.
 *
 * Separate from GET /api/messages on purpose: the header polls this on every
 * signed-in page, and serving the full inbox — every thread, its last message
 * and its participants — to render a single integer would make the most
 * frequent request in the app one of the most expensive.
 */
export async function GET() {
  const user = await getCurrentUser();
  // Not an error: a signed-out header simply has nothing to badge.
  if (!user) return NextResponse.json({ unread: 0 });

  return NextResponse.json({ unread: await unreadMessageCount(user.id) });
}

export const dynamic = "force-dynamic";
