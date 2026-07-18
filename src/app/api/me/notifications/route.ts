import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listNotifications, unreadCount, markAllRead } from "@/lib/notifications-store";

/** The viewer's personal notifications + unread count. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notifications: [], unread: 0 });
  const [notifications, unread] = await Promise.all([listNotifications(user.id), unreadCount(user.id)]);
  return NextResponse.json({ notifications, unread });
}

/** Mark all as read. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  await markAllRead(user.id);
  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
