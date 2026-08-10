import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import {
  blockUser, unblockUser, blockExistsBetween, blockedIdsFor, listBlocked, hasBlocked,
} from "@/lib/blocks/repo";
import { openConversation, sendMessage, listConversations, getConversation } from "@/lib/messages/repo";
import { resetDb, makeUser } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  Blocking — the Play UGC-policy control, pinned against a real database.
//
//  The property that actually matters and that a unit test cannot express: a
//  block is written ONE-DIRECTIONALLY and enforced SYMMETRICALLY. Almost every
//  bug this feature can have is "the gate only holds in the direction the row
//  was written in", so every test below runs the blocked party's leg too.
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

test("a block is stored one-way and enforced BOTH ways", async () => {
  const [a, b] = [await makeUser(), await makeUser()];

  assert.equal(await blockExistsBetween(a.id, b.id), false);
  await blockUser(a.id, b.id);

  // The row belongs to A…
  assert.equal(await hasBlocked(a.id, b.id), true);
  assert.equal(await hasBlocked(b.id, a.id), false, "B did not block anyone");
  // …but the GATE answers the same from either side. This is the whole design.
  assert.equal(await blockExistsBetween(a.id, b.id), true);
  assert.equal(await blockExistsBetween(b.id, a.id), true);
});

test("blocking is idempotent — a double tap does not throw or duplicate", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  await blockUser(a.id, b.id);
  await blockUser(a.id, b.id);
  assert.equal(await prisma.userBlock.count(), 1);
});

test("unblocking something already unblocked is a no-op, not a P2025", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  await unblockUser(a.id, b.id); // never blocked in the first place
  await blockUser(a.id, b.id);
  await unblockUser(a.id, b.id);
  await unblockUser(a.id, b.id);
  assert.equal(await blockExistsBetween(a.id, b.id), false);
});

test("you cannot block yourself", async () => {
  const a = await makeUser();
  await assert.rejects(() => blockUser(a.id, a.id), /block yourself/i);
});

test("blocking severs the follow edge in BOTH directions", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  await prisma.userFollow.createMany({
    data: [
      { followerId: a.id, followingId: b.id },
      { followerId: b.id, followingId: a.id },
    ],
  });

  await blockUser(a.id, b.id);

  assert.equal(await prisma.userFollow.count(), 0,
    "leaving either follow in place keeps pushing one person's activity at the other");
});

test("unblocking does NOT restore the severed follows", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  await prisma.userFollow.create({ data: { followerId: a.id, followingId: b.id } });
  await blockUser(a.id, b.id);
  await unblockUser(a.id, b.id);
  assert.equal(await prisma.userFollow.count(), 0);
});

test("blockedIdsFor returns the other party from EITHER leg", async () => {
  const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  await blockUser(a.id, b.id); // a blocked b
  await blockUser(c.id, a.id); // c blocked a

  const forA = (await blockedIdsFor(a.id)).sort();
  assert.deepEqual(forA, [b.id, c.id].sort(),
    "A must be filtered away from both the person they blocked and the person who blocked them");

  assert.deepEqual(await blockedIdsFor(b.id), [a.id]);
  assert.deepEqual(await blockedIdsFor(null), [], "anonymous has no blocks and must not query");
});

test("listBlocked shows only the blocks the viewer MADE", async () => {
  const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  await blockUser(a.id, b.id);
  await blockUser(c.id, a.id);

  const mine = await listBlocked(a.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, b.id, "C blocked A — A must never learn that");
});

// ── The DM surface: the reason this feature is a submission blocker ─────────

test("a blocked pair cannot open a conversation — from EITHER side", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  await blockUser(a.id, b.id);

  await assert.rejects(() => openConversation(a.id, b.id));
  await assert.rejects(() => openConversation(b.id, a.id),
    "the blocked party must not be able to mint the thread from their side");
});

test("a block landing AFTER the thread exists stops the next message", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const convo = await openConversation(a.id, b.id);
  await sendMessage(convo, b.id, "hello");

  // The ordinary case: you block someone BECAUSE of what they already sent.
  await blockUser(a.id, b.id);

  await assert.rejects(() => sendMessage(convo, b.id, "hello again"),
    "checking blocks only at open() would leave every existing thread writable");
  await assert.rejects(() => sendMessage(convo, a.id, "and stay gone"));
});

test("a blocked thread disappears from BOTH inboxes and reads as missing", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const convo = await openConversation(a.id, b.id);
  await sendMessage(convo, b.id, "hello");

  assert.equal((await listConversations(a.id)).length, 1);

  await blockUser(a.id, b.id);

  assert.equal((await listConversations(a.id)).length, 0);
  assert.equal((await listConversations(b.id)).length, 0);
  // Null, not a 403-shaped error: the id must not confirm the thread exists.
  assert.equal(await getConversation(convo, a.id), null);
  assert.equal(await getConversation(convo, b.id), null);
});

test("the inbox filter does not leak OTHER people's conversations", async () => {
  // Regression guard: the block filter and the ownership filter live on the
  // same Prisma relation key. Written as two spread objects, the second would
  // REPLACE the first and list every conversation in the database.
  const [a, b, c, d] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
  await sendMessage(await openConversation(c.id, d.id), c.id, "not for A");
  const mine = await openConversation(a.id, b.id);
  await sendMessage(mine, a.id, "mine");

  await blockUser(a.id, b.id); // forces the filtered branch to be taken

  const inbox = await listConversations(a.id);
  assert.deepEqual(inbox, [], "A is in no remaining conversation and must see none");
});

test("unblocking restores the conversation and its history", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const convo = await openConversation(a.id, b.id);
  await sendMessage(convo, b.id, "hello");
  await blockUser(a.id, b.id);
  await unblockUser(a.id, b.id);

  const view = await getConversation(convo, a.id);
  assert.ok(view, "the thread is filtered, never deleted");
  assert.equal((await listConversations(a.id)).length, 1);
});
