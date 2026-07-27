import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  pageNotifications, unreadCount, markAllRead, markRead, deleteNotifications,
  type NotificationRow,
} from "@/lib/notifications-store";
import { groupNotifications, type GroupableNotification } from "@/lib/notifications-group";

/**
 * The viewer's personal notifications.
 *
 * `?cursor=` pages backwards through history; `?group=0` returns the flat rows.
 * Grouping happens on the SERVER so the bell, the notification centre and any
 * future surface collapse identically — a client that grouped for itself would be
 * a second implementation to keep in step, and the two would drift.
 *
 * The unread count is always the WHOLE account's, never the page's: a badge that
 * counted only the first page would go quiet while unread notifications remained
 * further down.
 */
const serialise = (n: NotificationRow): GroupableNotification => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  url: n.url,
  icon: n.icon,
  dedupeKey: n.dedupeKey,
  readAt: n.readAt ? n.readAt.toISOString() : null,
  createdAt: n.createdAt.toISOString(),
});

export async function GET(req: Request) {
  const user = await getCurrentUser();
  // Signed out is not an error here — the bell renders for everyone and an empty
  // list is the honest answer.
  if (!user) return NextResponse.json({ notifications: [], groups: [], unread: 0, nextCursor: null });

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const grouped = url.searchParams.get("group") !== "0";

  const [page, unread] = await Promise.all([
    pageNotifications(user.id, { cursor, limit: Number.isFinite(limit) ? limit : 20 }),
    unreadCount(user.id),
  ]);

  const notifications = page.items.map(serialise);
  return NextResponse.json({
    notifications,
    groups: grouped ? groupNotifications(notifications) : notifications.map((n) => ({
      ...n, unread: !n.readAt, members: [n], count: 1,
    })),
    unread,
    nextCursor: page.nextCursor,
  });
}

/**
 * Mark read. `ids` marks exactly those rows (a collapsed group is many ids in ONE
 * request, which is what stops tapping a group of five being five round-trips);
 * omitting it marks the whole account read.
 *
 * POST with no body remains "mark all read" — the bell has used that contract since
 * before this route paged, and changing it would have broken the badge for anyone
 * with a stale bundle mid-deploy.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : null;

  if (ids && ids.length) {
    const read = await markRead(user.id, ids);
    return NextResponse.json({ ok: true, read, unread: await unreadCount(user.id) });
  }

  await markAllRead(user.id);
  return NextResponse.json({ ok: true, unread: 0 });
}

/** Delete rows the viewer owns. A group is deleted as its member ids, in one call. */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  if (!ids.length) return NextResponse.json({ error: "Nothing to delete." }, { status: 400 });

  const deleted = await deleteNotifications(user.id, ids);
  return NextResponse.json({ ok: true, deleted, unread: await unreadCount(user.id) });
}

export const dynamic = "force-dynamic";
