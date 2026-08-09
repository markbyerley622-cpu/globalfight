import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { anonKey } from "@/lib/feed/identity";
import { resetDb } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  H-2 — isolation proven against a real database.
//
//  The unit suite asserts that no client value can become an authenticated
//  identity. This asserts the consequence that actually matters: four distinct
//  principals write four distinct row-spaces, and none can read another's.
//
//  RLS IS NOT ENFORCED. This proves APPLICATION-layer isolation only — the
//  namespace makes the impersonating key unrepresentable, so the rows can never
//  be addressed. Do not read this file as evidence that the database refuses
//  the query; it does not, yet.
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

const user = (n: string) =>
  prisma.user.create({ data: { username: `feed${n}`, email: `feed${n}@t.test` } });

/** The shape every feed table shares: a `key` column naming the row-space. */
async function hide(key: string, channelId: string) {
  await prisma.feedHiddenChannel.createMany({ data: [{ key, channelId }], skipDuplicates: true });
}
const hiddenFor = (key: string) =>
  prisma.feedHiddenChannel.findMany({ where: { key }, select: { channelId: true } });

test("four principals, four row-spaces — and an attacker cannot address a user's", async () => {
  const a = await user("a");
  const b = await user("b");

  // Authenticated identity is the RAW session uid (unchanged by the fix, so no
  // signed-in user loses a row).
  await hide(a.id, "UC_userA_secret");
  await hide(b.id, "UC_userB_secret");

  // Two anonymous browsers, each with its own client id.
  const anonA = anonKey("c_browser1abc");
  const anonB = anonKey("c_browser2xyz");
  await hide(anonA, "UC_anonA");
  await hide(anonB, "UC_anonB");

  // THE ATTACK: an anonymous caller sends the victim's User.id as their cid,
  // read off the public leaderboard. Before the fix this resolved to `a.id`
  // verbatim and addressed user A's rows.
  const attacker = anonKey(a.id);
  assert.notEqual(attacker, a.id, "the attacker's key still equals the victim's — H-2 is open");

  const stolen = await hiddenFor(attacker);
  assert.deepEqual(stolen, [], "the attacker's namespaced key reached rows belonging to user A");

  // And a write under that key must not touch user A.
  await hide(attacker, "UC_injected_by_attacker");
  const victim = (await hiddenFor(a.id)).map((r) => r.channelId);
  assert.deepEqual(victim, ["UC_userA_secret"], "an anonymous write landed in user A's row-space");

  // Every space stays separate.
  assert.deepEqual((await hiddenFor(b.id)).map((r) => r.channelId), ["UC_userB_secret"]);
  assert.deepEqual((await hiddenFor(anonA)).map((r) => r.channelId), ["UC_anonA"]);
  assert.deepEqual((await hiddenFor(anonB)).map((r) => r.channelId), ["UC_anonB"]);
});

test("anonymous callers are isolated from each other", async () => {
  const one = anonKey("c_aaaa1111");
  const two = anonKey("c_bbbb2222");
  await hide(one, "UC_one");
  assert.deepEqual(await hiddenFor(two), [], "one anonymous browser can see another's preferences");
});

test("junk client ids share ONE bucket and never reach a user", async () => {
  const a = await user("j");
  await hide(a.id, "UC_user_j");

  // Anything unusable collapses to the shared anonymous bucket — the
  // pre-existing behaviour of `cid || "anon"`, now inside the namespace.
  for (const junk of ["", "   ", "x", "has space", "../../etc/passwd"]) {
    const k = anonKey(junk);
    await hide(k, `UC_junk_${Buffer.from(junk).toString("hex").slice(0, 8)}`);
  }
  const reached = await hiddenFor(a.id);
  assert.deepEqual(reached.map((r) => r.channelId), ["UC_user_j"], "a junk id reached a user's rows");
});

test("a saved library is not readable by an attacker who knows the owner's id", async () => {
  const owner = await user("lib");
  await prisma.feedCollection.create({ data: { key: owner.id, name: "Favorites", system: "favorites" } });

  const attacker = anonKey(owner.id);
  const seen = await prisma.feedCollection.findMany({ where: { key: attacker } });
  assert.deepEqual(seen, [], "the attacker read the owner's saved collections");

  // The owner still has theirs.
  assert.equal((await prisma.feedCollection.findMany({ where: { key: owner.id } })).length, 1);
});
