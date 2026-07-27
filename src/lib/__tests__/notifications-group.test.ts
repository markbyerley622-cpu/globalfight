import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNotifications, subjectKey, type GroupableNotification } from "@/lib/notifications-group";

// Grouping is PURE, so it is tested against hand-built lists rather than a database.
// These pin the properties the UI depends on: that a group keeps its members' unread
// state, its newest timestamp and a real deep link — and that it does NOT collapse
// things a reader needs to see separately.

let seq = 0;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function n(over: Partial<GroupableNotification> = {}): GroupableNotification {
  return {
    id: `n${seq++}`,
    type: "GYM_REVIEW",
    title: "Something happened",
    body: null,
    url: "/gyms/gracie#reviews",
    icon: "⭐",
    dedupeKey: `gym_review:gym1:${seq}`,
    readAt: null,
    createdAt: at(seq),
    ...over,
  };
}

// ── the subject key ─────────────────────────────────────────────────────────

test("the subject is the fact + the entity, not the whole dedupe key", () => {
  assert.equal(subjectKey(n({ dedupeKey: "gym_review:gym1:author9:created" })), "gym_review:gym1");
  assert.equal(subjectKey(n({ dedupeKey: "fight_result:f42" })), "fight_result:f42");
});

test("a fact about the VIEWER is never grouped", () => {
  // "rep:1000" and "rep:2500" are two distinct achievements. Collapsing them into
  // one row would hide one behind the other, which is not de-duplication.
  assert.equal(subjectKey(n({ dedupeKey: "rep:1000" })), null);
  assert.equal(subjectKey(n({ dedupeKey: "streak_warn:2026-07-27" })), null);
});

test("without a dedupeKey the URL is the subject, ignoring the hash", () => {
  assert.equal(
    subjectKey(n({ dedupeKey: null, url: "/events/ufc-300#fight-9" })),
    "url:/events/ufc-300",
  );
});

// ── subject collapse ────────────────────────────────────────────────────────

test("three things about ONE gym collapse into one row with a count", () => {
  const rows = [
    n({ dedupeKey: "gym_review:gym1:a:created", title: "John reviewed your gym", createdAt: at(1) }),
    n({ dedupeKey: "gym_review:gym1:a:edited", title: "John edited the review", createdAt: at(5) }),
    n({ dedupeKey: "gym_review:gym1:b:created", title: "Ana reviewed your gym", createdAt: at(9) }),
  ];
  const [g, ...rest] = groupNotifications(rows);
  assert.equal(rest.length, 0, "one group, not three rows");
  assert.equal(g.count, 3);
  assert.equal(g.body, "3 updates");
  assert.equal(g.title, "John reviewed your gym", "the newest member names the group");
  assert.equal(g.createdAt, rows[0].createdAt, "the group carries the NEWEST timestamp");
  assert.equal(g.url, rows[0].url, "and the newest member's deep link");
  assert.deepEqual(g.members.map((m) => m.id), rows.map((r) => r.id), "every member travels with it");
});

test("a group is unread if ANY member is unread", () => {
  const [g] = groupNotifications([
    n({ dedupeKey: "gym_review:gym1:a:created", readAt: at(0) }),
    n({ dedupeKey: "gym_review:gym1:b:created", readAt: null }),
  ]);
  assert.equal(g.unread, true, "a half-read group is not read");
});

test("a fully-read group is read", () => {
  const [g] = groupNotifications([
    n({ dedupeKey: "gym_review:gym1:a:created", readAt: at(0) }),
    n({ dedupeKey: "gym_review:gym1:b:created", readAt: at(1) }),
  ]);
  assert.equal(g.unread, false);
});

test("different subjects are NOT collapsed together", () => {
  const groups = groupNotifications([
    n({ dedupeKey: "gym_review:gym1:a:created" }),
    n({ dedupeKey: "gym_review:gym2:a:created" }),
  ]);
  // Two gyms, two rows — below the kind-group threshold of three.
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.count === 1));
});

// ── kind collapse ───────────────────────────────────────────────────────────

test("five fight announcements across five cards become one summary row", () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    n({
      type: "FIGHT_ANNOUNCED",
      dedupeKey: `fight_announced:f${i}`,
      title: `Bout ${i} announced`,
      url: `/events/e${i}#fight-f${i}`,
      createdAt: at(i + 1),
    }),
  );
  const groups = groupNotifications(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 5);
  assert.equal(groups[0].title, "5 cards you follow have updates");
  assert.equal(groups[0].url, rows[0].url, "a summary still lands somewhere real");
  assert.equal(groups[0].unread, true);
});

test("two of a kind stay as themselves — a summary of two is worse than two rows", () => {
  const groups = groupNotifications([
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f1", title: "A vs B" }),
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f2", title: "C vs D" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.title).sort(), ["A vs B", "C vs D"]);
});

test("a type with no kind-group entry is never summarised", () => {
  // SYSTEM is deliberately absent from KIND_GROUPS: "3 system messages" tells the
  // reader nothing, and each one is its own thing.
  const groups = groupNotifications(
    Array.from({ length: 4 }, (_, i) => n({ type: "SYSTEM", dedupeKey: `sys:x${i}`, title: `Notice ${i}` })),
  );
  assert.equal(groups.length, 4);
});

test("a subject group is not folded into a kind group — no count behind a count", () => {
  const rows = [
    // one subject group of 2…
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f1", createdAt: at(1) }),
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f1", createdAt: at(2) }),
    // …plus three singles, which are enough to kind-group on their own
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f2", createdAt: at(3) }),
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f3", createdAt: at(4) }),
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: "fight_announced:f4", createdAt: at(5) }),
  ];
  const groups = groupNotifications(rows);
  assert.equal(groups.length, 2, "the subject group survives beside the kind group");
  const subject = groups.find((g) => g.count === 2);
  const kind = groups.find((g) => g.title.startsWith("3 cards"));
  assert.ok(subject, "the 2-member subject group is still its own row");
  assert.ok(kind, "the three singles collapsed");
});

test("only the recent run collapses — older ones stay as themselves", () => {
  const recent = Array.from({ length: 3 }, (_, i) =>
    n({ type: "FIGHT_ANNOUNCED", dedupeKey: `fight_announced:r${i}`, createdAt: at(i + 1) }),
  );
  const ancient = n({
    type: "FIGHT_ANNOUNCED",
    dedupeKey: "fight_announced:old",
    title: "From last week",
    createdAt: at(60 * 24 * 8),
  });
  const groups = groupNotifications([...recent, ancient]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 3, "this week's run collapsed");
  assert.equal(groups[1].title, "From last week", "last week's did not join it");
});

// ── ordering ────────────────────────────────────────────────────────────────

test("the output is newest-first regardless of input order", () => {
  const groups = groupNotifications([
    n({ dedupeKey: "gym_review:g3:a:created", createdAt: at(30) }),
    n({ dedupeKey: "gym_review:g1:a:created", createdAt: at(1) }),
    n({ dedupeKey: "gym_review:g2:a:created", createdAt: at(10) }),
  ]);
  const times = groups.map((g) => g.createdAt);
  assert.deepEqual([...times].sort((a, b) => b.localeCompare(a)), times);
});

test("an empty list groups to nothing", () => {
  assert.deepEqual(groupNotifications([]), []);
});
