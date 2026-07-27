import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import {
  notify, notifyMany, pageNotifications, unreadCount, markAllRead, markRead, deleteNotifications,
} from "@/lib/notifications-store";
import { groupNotifications } from "@/lib/notifications-group";
import { resetDb, makeUser } from "./helpers";

// The notification CENTRE's data layer: keyset pagination, the batched insert, and
// the per-row read/delete operations the UI drives optimistically. Grouping itself
// is unit-tested (src/lib/__tests__/notifications-group.test.ts); this pins that
// real rows from the store group the way the UI expects.

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

/** N notifications for one user, oldest first, with distinct createdAt. */
async function seed(userId: string, count: number, over: Record<string, unknown> = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      userId,
      type: "SYSTEM" as const,
      title: `Notice ${i}`,
      dedupeKey: `sys:${userId}:${i}`,
      // Explicit, spaced timestamps: rows inserted in the same millisecond have no
      // deterministic order, and a pagination test that depends on insertion luck
      // is a flake waiting to happen.
      createdAt: new Date(Date.now() - (count - i) * 60_000),
      ...over,
    });
  }
  await prisma.notification.createMany({ data: rows });
}

// ── batched insert ──────────────────────────────────────────────────────────

test("notifyMany writes one row per user in a single insert", async () => {
  const users = await Promise.all([makeUser(), makeUser(), makeUser()]);
  const sent = await notifyMany(users.map((u) => u.id), {
    type: "FIGHT_ANNOUNCED", title: "Card announced", url: "/events/x", dedupeKey: "event_announced:x",
  });
  assert.equal(sent, 3);
  assert.equal(await prisma.notification.count(), 3);
});

test("notifyMany is idempotent on its dedupeKey", async () => {
  const users = await Promise.all([makeUser(), makeUser()]);
  const payload = {
    type: "FIGHT_ANNOUNCED" as const, title: "Card announced", url: "/events/x",
    dedupeKey: "event_announced:x",
  };
  assert.equal(await notifyMany(users.map((u) => u.id), payload), 2);
  assert.equal(await notifyMany(users.map((u) => u.id), payload), 0, "a re-run creates nothing");
  assert.equal(await prisma.notification.count(), 2);
});

test("notifyMany only counts the users it actually inserted for", async () => {
  const [a, b] = await Promise.all([makeUser(), makeUser()]);
  const payload = {
    type: "FIGHT_ANNOUNCED" as const, title: "Card announced", url: "/e", dedupeKey: "event_announced:y",
  };
  await notifyMany([a.id], payload);
  // b is new to this fact; a already had it.
  assert.equal(await notifyMany([a.id, b.id], payload), 1);
});

test("notifyMany de-duplicates the caller's own list", async () => {
  const u = await makeUser();
  const sent = await notifyMany([u.id, u.id, u.id], {
    type: "SYSTEM", title: "Once", dedupeKey: "sys:once",
  });
  assert.equal(sent, 1);
});

test("notifyMany with no dedupeKey inserts every time — repeatable by design", async () => {
  const u = await makeUser();
  const payload = { type: "COMMUNITY_REPLY" as const, title: "Someone replied", url: "/t" };
  await notifyMany([u.id], payload);
  await notifyMany([u.id], payload);
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 2);
});

// ── pagination ──────────────────────────────────────────────────────────────

test("pagination walks the whole history without repeating or skipping a row", async () => {
  const u = await makeUser();
  await seed(u.id, 25);

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const page = await pageNotifications(u.id, { cursor, limit: 10 });
    seen.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  assert.equal(seen.length, 25, "every row was returned");
  assert.equal(new Set(seen).size, 25, "and none of them twice");
});

test("the first page is newest-first and reports more below", async () => {
  const u = await makeUser();
  await seed(u.id, 5);
  const page = await pageNotifications(u.id, { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].title, "Notice 4", "newest first");
  assert.ok(page.nextCursor, "there is more");
});

test("the last page reports no cursor", async () => {
  const u = await makeUser();
  await seed(u.id, 3);
  const page = await pageNotifications(u.id, { limit: 10 });
  assert.equal(page.items.length, 3);
  assert.equal(page.nextCursor, null);
});

test("a page never leaks another user's notifications", async () => {
  const [a, b] = await Promise.all([makeUser(), makeUser()]);
  await seed(a.id, 3);
  await seed(b.id, 3);
  const page = await pageNotifications(a.id, { limit: 50 });
  assert.equal(page.items.length, 3);
  assert.ok(page.items.every((i) => i.userId === a.id));
});

test("the page size is clamped — a client cannot ask for the whole table", async () => {
  const u = await makeUser();
  await seed(u.id, 60);
  const page = await pageNotifications(u.id, { limit: 5000 });
  assert.equal(page.items.length, 50, "capped at 50");
});

// ── read state ──────────────────────────────────────────────────────────────

test("markRead marks exactly the ids given, and the count follows", async () => {
  const u = await makeUser();
  await seed(u.id, 4);
  const page = await pageNotifications(u.id, { limit: 4 });
  assert.equal(await unreadCount(u.id), 4);

  const marked = await markRead(u.id, [page.items[0].id, page.items[1].id]);
  assert.equal(marked, 2);
  assert.equal(await unreadCount(u.id), 2);
});

test("markRead cannot touch another user's notification", async () => {
  const [a, b] = await Promise.all([makeUser(), makeUser()]);
  await seed(b.id, 1);
  const victim = (await pageNotifications(b.id, { limit: 1 })).items[0];

  // `a` sends `b`'s id, which is exactly the attack the userId scoping exists for.
  assert.equal(await markRead(a.id, [victim.id]), 0);
  assert.equal(await unreadCount(b.id), 1, "b's notification is untouched");
});

test("marking an already-read row again is a no-op, not a re-stamp", async () => {
  const u = await makeUser();
  await seed(u.id, 1);
  const row = (await pageNotifications(u.id, { limit: 1 })).items[0];
  await markRead(u.id, [row.id]);
  const first = await prisma.notification.findUnique({ where: { id: row.id } });
  assert.equal(await markRead(u.id, [row.id]), 0);
  const second = await prisma.notification.findUnique({ where: { id: row.id } });
  assert.equal(+second!.readAt!, +first!.readAt!, "the original read time stands");
});

test("markAllRead zeroes the count and leaves the rows in place", async () => {
  const u = await makeUser();
  await seed(u.id, 6);
  await markAllRead(u.id);
  assert.equal(await unreadCount(u.id), 0);
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 6, "read is not deleted");
});

test("markRead with an empty list does nothing", async () => {
  const u = await makeUser();
  await seed(u.id, 2);
  assert.equal(await markRead(u.id, []), 0);
  assert.equal(await unreadCount(u.id), 2);
});

// ── delete ──────────────────────────────────────────────────────────────────

test("delete removes the rows and drops the unread count", async () => {
  const u = await makeUser();
  await seed(u.id, 3);
  const page = await pageNotifications(u.id, { limit: 3 });
  assert.equal(await deleteNotifications(u.id, [page.items[0].id, page.items[1].id]), 2);
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 1);
  assert.equal(await unreadCount(u.id), 1);
});

test("delete cannot remove another user's notification", async () => {
  const [a, b] = await Promise.all([makeUser(), makeUser()]);
  await seed(b.id, 1);
  const victim = (await pageNotifications(b.id, { limit: 1 })).items[0];
  assert.equal(await deleteNotifications(a.id, [victim.id]), 0);
  assert.equal(await prisma.notification.count({ where: { userId: b.id } }), 1);
});

test("deleting a row frees its dedupeKey — the fact can be delivered again", async () => {
  // Worth pinning: the (userId, dedupeKey) unique is what makes a fact once-ever, so
  // a reader who DELETES a notification and then triggers the same fact will see it
  // again. That is the correct behaviour (they threw it away, they did not mute it),
  // and it is the kind of thing that surprises someone reading the code later.
  const u = await makeUser();
  await notify(prisma, u.id, { type: "SYSTEM", title: "Once", dedupeKey: "sys:k" });
  const row = (await pageNotifications(u.id, { limit: 1 })).items[0];
  await deleteNotifications(u.id, [row.id]);
  await notify(prisma, u.id, { type: "SYSTEM", title: "Once", dedupeKey: "sys:k" });
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 1);
});

// ── the store feeding the grouper ───────────────────────────────────────────

test("real rows from the store group the way the centre renders them", async () => {
  const u = await makeUser();
  // Three facts about ONE gym — the canonical "John interacted with your gym" case.
  for (const [i, key] of ["a:created", "a:edited", "b:created"].entries()) {
    await prisma.notification.create({
      data: {
        userId: u.id, type: "GYM_REVIEW", title: `Review event ${i}`,
        url: "/gyms/gracie#reviews", dedupeKey: `gym_review:gym1:${key}`,
        createdAt: new Date(Date.now() - i * 60_000),
      },
    });
  }

  const page = await pageNotifications(u.id, { limit: 20 });
  const groups = groupNotifications(
    page.items.map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, icon: n.icon,
      dedupeKey: n.dedupeKey,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].body, "3 updates");
  assert.equal(groups[0].unread, true);

  // And the group's member ids are exactly what the UI posts to mark it read.
  const marked = await markRead(u.id, groups[0].members.map((m) => m.id));
  assert.equal(marked, 3);
  assert.equal(await unreadCount(u.id), 0);
});
