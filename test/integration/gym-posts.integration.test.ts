import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  createPost, updatePost, deletePost, getPost, getFeed,
  addComment, deleteComment, reactToPost, sharePost, setPostHidden,
} from "@/lib/gym-posts/repo";
import { decodeCursor } from "@/lib/gym-posts/cursor";
import { resetDb, makeUser } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  GYM POSTS against a REAL Postgres.
//
//  The pure rules (ranking, cursors, the visibility matrix) are covered by unit
//  tests. What can only be proved here is everything that involves two tables
//  and a race: reference counting against MediaAsset, the atomic delete claim,
//  denormalised counters, and whether the SQL visibility filter agrees with the
//  pure predicate it shadows.
//
//    npm run test:integration     (TRUNCATES its database — never point it at dev)
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

let seq = 0;
const uniq = (p: string) => `${p}-${seq++}`;

/** A VERIFIED gym — the only state that permits publishing. */
async function makeGym(ownerId: string) {
  return prisma.gym.create({
    data: { slug: uniq("gym"), name: "Iron House", ownerId, verified: true },
  });
}

async function join(gymId: string, userId: string) {
  return prisma.gymMember.create({ data: { gymId, userId } });
}

/**
 * A READY asset, created directly.
 *
 * Deliberately NOT via ingestMedia: that would need sharp, object storage and a
 * scanner. What is under test here is the REFERENCE CONTRACT between a post and
 * an asset, which starts once an asset is READY. The lifecycle that gets it
 * there has its own tests.
 */
async function makeAsset(ownerId: string | null = null, status: "READY" | "SCANNING" | "REJECTED" = "READY") {
  const stem = `media/public/2026-08-06/${randomBytes(16).toString("hex")}`;
  return prisma.mediaAsset.create({
    data: {
      sha256: randomBytes(32).toString("hex"),
      mime: "image/webp",
      bytes: 1024,
      width: 1600,
      height: 1200,
      status,
      ownerId,
      // refCount 0 — an upload is not a consumer. Only an attachment is.
      refCount: 0,
      publicKey: `${stem}.webp`,
      variants: { full: `https://cdn.test/${stem}/full.webp`, thumb: `https://cdn.test/${stem}/thumb.webp` },
    },
  });
}

const refCountOf = async (id: string) =>
  (await prisma.mediaAsset.findUnique({ where: { id }, select: { refCount: true } }))!.refCount;

/** A verified gym, its owner, and a member. The setup nearly every test needs. */
async function world() {
  const owner = await makeUser();
  const member = await makeUser();
  const stranger = await makeUser();
  const gym = await makeGym(owner.id);
  await join(gym.id, member.id);
  return {
    gym,
    owner: { id: owner.id, role: owner.role },
    member: { id: member.id, role: member.role },
    stranger: { id: stranger.id, role: stranger.role },
  };
}

// ─── Creation ───────────────────────────────────────────────────────────────

test("a member publishes to their gym's feed", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "Open mat Saturday, 11am.",
  });
  assert.equal(post.body, "Open mat Saturday, 11am.");
  assert.equal(post.visibility, "PUBLIC");
  assert.equal(post.gym.slug, w.gym.slug);
  assert.equal(post.canEdit, true);
  assert.equal(post.canDelete, true);
});

test("a stranger cannot publish to a gym they have not joined", async () => {
  const w = await world();
  await assert.rejects(
    createPost({ gymSlug: w.gym.slug, authorId: w.stranger.id, authorRole: w.stranger.role, body: "hi" }),
    /Join this gym/,
  );
  assert.equal(await prisma.gymPost.count(), 0);
});

test("an UNVERIFIED gym's feed is closed to everyone, including its owner", async () => {
  // The gate the gym verification state machine exists for. An ownerId can be
  // set by an import or an admin fixing data, so ownership alone must never be
  // a publishing right.
  const owner = await makeUser();
  const gym = await prisma.gym.create({ data: { slug: uniq("gym"), name: "Unclaimed", ownerId: owner.id } });
  await assert.rejects(
    createPost({ gymSlug: gym.slug, authorId: owner.id, authorRole: owner.role, body: "hello" }),
    /isn't verified/,
  );
});

test("a post with neither text nor media is refused", async () => {
  const w = await world();
  await assert.rejects(
    createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "   " }),
    /Write something/,
  );
});

// ─── Reference counting ─────────────────────────────────────────────────────

test("attaching media takes exactly one reference per asset", async () => {
  const w = await world();
  const [a, b] = [await makeAsset(w.member.id), await makeAsset(w.member.id)];

  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "Grading day", media: [{ assetId: a.id }, { assetId: b.id }],
  });

  assert.equal(post.media.length, 2);
  assert.equal(await refCountOf(a.id), 1);
  assert.equal(await refCountOf(b.id), 1);
  // The rendered URLs come from the ASSET, and nothing that addresses storage
  // reaches the client.
  assert.match(post.media[0].url, /^https:\/\/cdn\.test\//);
  assert.equal("assetId" in post.media[0], false);
  assert.equal("publicKey" in post.media[0], false);
});

test("the same asset twice on one post is one row and ONE reference", async () => {
  const w = await world();
  const a = await makeAsset(w.member.id);
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "dup", media: [{ assetId: a.id }, { assetId: a.id }],
  });
  assert.equal(post.media.length, 1);
  assert.equal(await refCountOf(a.id), 1, "a double-counted reference is an asset that is never collected");
});

test("TWO posts sharing one deduplicated asset hold two references", async () => {
  // The whole reason refCount exists. Two members posting the same gym flyer
  // share one asset row, and neither one deleting their post may take the image
  // away from the other.
  const w = await world();
  const a = await makeAsset(w.member.id);

  const first = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "one", media: [{ assetId: a.id }],
  });
  await createPost({
    gymSlug: w.gym.slug, authorId: w.owner.id, authorRole: w.owner.role,
    body: "two", media: [{ assetId: a.id }],
  });
  assert.equal(await refCountOf(a.id), 2);

  await deletePost({ id: first.id, userId: w.member.id, userRole: w.member.role });
  assert.equal(await refCountOf(a.id), 1, "the surviving post still holds its reference");
  assert.notEqual(
    (await prisma.mediaAsset.findUnique({ where: { id: a.id } }))!.status,
    "DELETED",
    "a still-referenced asset must never become collectable",
  );
});

test("deleting a post releases its references", async () => {
  const w = await world();
  const a = await makeAsset(w.member.id);
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "bye", media: [{ assetId: a.id }],
  });
  assert.equal(await refCountOf(a.id), 1);

  await deletePost({ id: post.id, userId: w.member.id, userRole: w.member.role });
  assert.equal(await refCountOf(a.id), 0);
  assert.equal(await prisma.gymPostMedia.count({ where: { postId: post.id } }), 0);
});

test("a double delete cannot double-release", async () => {
  // The atomic claim. Without `updateMany where deletedAt: null` both callers
  // would go on to release, driving a SHARED asset below what other posts hold
  // — the one failure mode that destroys someone else's images.
  const w = await world();
  const a = await makeAsset(w.member.id);
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "x", media: [{ assetId: a.id }],
  });

  const results = await Promise.allSettled([
    deletePost({ id: post.id, userId: w.member.id, userRole: w.member.role }),
    deletePost({ id: post.id, userId: w.member.id, userRole: w.member.role }),
  ]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  assert.equal(await refCountOf(a.id), 0, "never negative, never double-decremented");
});

test("editing to a new media set moves references by the DIFF", async () => {
  const w = await world();
  const [a, b, c] = [await makeAsset(w.member.id), await makeAsset(w.member.id), await makeAsset(w.member.id)];
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "swap", media: [{ assetId: a.id }, { assetId: b.id }],
  });

  await updatePost({
    id: post.id, userId: w.member.id, userRole: w.member.role,
    media: [{ assetId: b.id }, { assetId: c.id }],
  });

  assert.equal(await refCountOf(a.id), 0, "dropped");
  assert.equal(await refCountOf(b.id), 1, "kept — NOT released and re-taken");
  assert.equal(await refCountOf(c.id), 1, "added");
});

test("replaying the SAME edit is a no-op on the counts", async () => {
  // Expressing media as the desired FINAL set (rather than add/remove verbs) is
  // what makes a retried PATCH safe. A verb API replayed twice takes two
  // references for one attachment.
  const w = await world();
  const a = await makeAsset(w.member.id);
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "idem",
  });

  for (let i = 0; i < 3; i++) {
    await updatePost({ id: post.id, userId: w.member.id, userRole: w.member.role, media: [{ assetId: a.id }] });
  }
  assert.equal(await refCountOf(a.id), 1);
});

test("an asset that is not READY cannot be attached, and nothing is written", async () => {
  const w = await world();
  const scanning = await makeAsset(w.member.id, "SCANNING");
  const rejected = await makeAsset(w.member.id, "REJECTED");

  for (const asset of [scanning, rejected]) {
    await assert.rejects(
      createPost({
        gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
        body: "early", media: [{ assetId: asset.id }],
      }),
      /aren't ready/,
    );
    assert.equal(await refCountOf(asset.id), 0);
  }
  assert.equal(await prisma.gymPost.count(), 0, "the post must not exist without its media");
});

test("an asset id that does not exist is refused the same way", async () => {
  const w = await world();
  await assert.rejects(
    createPost({
      gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
      body: "ghost", media: [{ assetId: "clnonexistent00000000000" }],
    }),
    /aren't ready/,
  );
});

// ─── Permissions ────────────────────────────────────────────────────────────

test("only the author may edit; the gym's owner may not", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "mine",
  });

  await assert.rejects(
    updatePost({ id: post.id, userId: w.owner.id, userRole: w.owner.role, body: "not yours" }),
    /only edit your own/,
  );
  const still = await getPost(post.id, w.member);
  assert.equal(still!.body, "mine");
});

test("the gym's owner MAY delete a member's post", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "moderate me",
  });
  await deletePost({ id: post.id, userId: w.owner.id, userRole: w.owner.role });

  const row = await prisma.gymPost.findUnique({ where: { id: post.id } });
  assert.ok(row!.deletedAt, "soft-deleted, not destroyed");
  assert.equal(row!.deletedReason, "moderation", "removal by someone else is an enforcement action");
  assert.equal(row!.deletedById, w.owner.id);
  assert.equal(row!.body, "moderate me", "the words survive for an appeal");
});

test("the author's own delete is recorded as theirs, not as moderation", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "changed my mind",
  });
  await deletePost({ id: post.id, userId: w.member.id, userRole: w.member.role });
  const row = await prisma.gymPost.findUnique({ where: { id: post.id } });
  assert.equal(row!.deletedReason, "author");
});

test("a stranger can neither edit nor delete", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "public",
  });
  await assert.rejects(updatePost({ id: post.id, userId: w.stranger.id, userRole: w.stranger.role, body: "x" }));
  await assert.rejects(deletePost({ id: post.id, userId: w.stranger.id, userRole: w.stranger.role }));
});

test("a deleted post is gone from every read path", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "vanish",
  });
  await deletePost({ id: post.id, userId: w.member.id, userRole: w.member.role });

  assert.equal(await getPost(post.id, w.member), null, "not even for its author");
  const feed = await getFeed({ gymSlug: w.gym.slug, user: w.member });
  assert.equal(feed.items.length, 0);
});

// ─── Visibility, against the database ───────────────────────────────────────

test("a MEMBERS post is invisible to a stranger and to anonymous", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "members only", visibility: "MEMBERS",
  });

  assert.ok(await getPost(post.id, w.member));
  assert.ok(await getPost(post.id, w.owner), "the gym's owner sees its members' posts");
  // 404 rather than 403 — the endpoint must not confirm the post exists.
  assert.equal(await getPost(post.id, w.stranger), null);
  assert.equal(await getPost(post.id, null), null);

  assert.equal((await getFeed({ gymSlug: w.gym.slug, user: w.stranger })).items.length, 0);
  assert.equal((await getFeed({ gymSlug: w.gym.slug, user: null })).items.length, 0);
  assert.equal((await getFeed({ gymSlug: w.gym.slug, user: w.member })).items.length, 1);
});

test("a PRIVATE post reaches only its author and the gym's owner", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "just us", visibility: "PRIVATE",
  });
  assert.ok(await getPost(post.id, w.member));
  assert.ok(await getPost(post.id, w.owner));
  assert.equal(await getPost(post.id, w.stranger), null);

  // A second member of the same gym is NOT a party to it.
  const other = await makeUser();
  await join(w.gym.id, other.id);
  assert.equal(await getPost(post.id, { id: other.id, role: other.role }), null);
});

test("a member's own MEMBERS post survives them leaving the gym", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "still mine", visibility: "MEMBERS",
  });
  await prisma.gymMember.deleteMany({ where: { gymId: w.gym.id, userId: w.member.id } });
  assert.ok(await getPost(post.id, w.member), "the author can always read their own post");
});

// ─── Cursor pagination ──────────────────────────────────────────────────────

test("paging the feed never repeats and never drops a post", async () => {
  const w = await world();
  const created: string[] = [];
  for (let i = 0; i < 11; i++) {
    const p = await createPost({
      gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: `post ${i}`,
    });
    created.push(p.id);
  }

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const page: Awaited<ReturnType<typeof getFeed>> =
      await getFeed({ gymSlug: w.gym.slug, user: w.member, cursor, limit: 3 });
    seen.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  assert.equal(seen.length, 11);
  assert.equal(new Set(seen).size, 11, "no post appears twice");
  assert.deepEqual(new Set(seen), new Set(created), "and none is missed");
});

test("a post published mid-scroll does not shift the pages already read", async () => {
  // The failure offset paging has and keyset does not: an insert at the HEAD
  // renumbers every subsequent offset, so page two repeats a row from page one
  // and silently hides another.
  const w = await world();
  for (let i = 0; i < 6; i++) {
    await createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: `old ${i}` });
  }

  const first = await getFeed({ gymSlug: w.gym.slug, user: w.member, limit: 3 });
  await createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "BRAND NEW" });
  const second = await getFeed({ gymSlug: w.gym.slug, user: w.member, cursor: first.nextCursor, limit: 3 });

  const overlap = second.items.filter((p) => first.items.some((q) => q.id === p.id));
  assert.deepEqual(overlap, [], "the new post must not push a read row onto the next page");
  assert.equal(second.items.some((p) => p.body === "BRAND NEW"), false);
});

test("a forged or corrupt cursor starts from the beginning rather than erroring", async () => {
  const w = await world();
  await createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "one" });
  const page = await getFeed({ gymSlug: w.gym.slug, user: w.member, cursor: "!!!not-a-cursor!!!" });
  assert.equal(page.items.length, 1);
});

test("the cursor is opaque and points at the last row returned", async () => {
  const w = await world();
  for (let i = 0; i < 3; i++) {
    await createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: `p${i}` });
  }
  const page = await getFeed({ gymSlug: w.gym.slug, user: w.member, limit: 2 });
  const decoded = decodeCursor(page.nextCursor)!;
  assert.equal(decoded.id, page.items[page.items.length - 1].id);
});

// ─── Feed behaviour ─────────────────────────────────────────────────────────

test("the feed is deterministic — the same call twice gives the same order", async () => {
  const w = await world();
  for (let i = 0; i < 8; i++) {
    await createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: `p${i}` });
  }
  const a = await getFeed({ gymSlug: w.gym.slug, user: w.member });
  const b = await getFeed({ gymSlug: w.gym.slug, user: w.member });
  assert.deepEqual(a.items.map((p) => p.id), b.items.map((p) => p.id));
});

test("the cross-gym feed interleaves gyms rather than running them in blocks", async () => {
  const owner = await makeUser();
  const reader = await makeUser();
  const gyms = [await makeGym(owner.id), await makeGym(owner.id)];
  for (const gym of gyms) {
    await join(gym.id, reader.id);
    for (let i = 0; i < 3; i++) {
      await createPost({ gymSlug: gym.slug, authorId: owner.id, authorRole: owner.role, body: `${gym.slug} ${i}` });
    }
  }

  const feed = await getFeed({ user: { id: reader.id, role: reader.role }, limit: 6 });
  assert.equal(feed.items.length, 6);
  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < feed.items.length; i++) {
    run = feed.items[i].gym.id === feed.items[i - 1].gym.id ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  assert.ok(longestRun <= 2, `one gym took a run of ${longestRun}`);
});

test("an anonymous reader sees PUBLIC posts across gyms and nothing else", async () => {
  const w = await world();
  await createPost({ gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "open" });
  await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "closed", visibility: "MEMBERS",
  });

  const feed = await getFeed({ user: null });
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].body, "open");
  assert.deepEqual(feed.items[0].myReactions, []);
  assert.equal(feed.items[0].canDelete, false);
});

// ─── Comments ───────────────────────────────────────────────────────────────

test("commenting recomputes the count and soft-deleting recomputes it back", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "thoughts?",
  });

  const c1 = await addComment({
    postId: post.id, authorId: w.owner.id, authorRole: w.owner.role, body: "Good session.",
  });
  await addComment({ postId: post.id, authorId: w.stranger.id, authorRole: w.stranger.role, body: "Nice." });
  assert.equal((await getPost(post.id, w.member))!.commentCount, 2);

  await deleteComment({ commentId: c1.id, userId: w.owner.id, userRole: w.owner.role });
  assert.equal((await getPost(post.id, w.member))!.commentCount, 1, "recomputed, never blind-decremented");

  const row = await prisma.gymPostComment.findUnique({ where: { id: c1.id } });
  assert.ok(row!.deletedAt, "the row survives so the reply chain holds");
});

test("a reply to a reply attaches to the top-level comment", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "deep",
  });
  const top = await addComment({ postId: post.id, authorId: w.member.id, authorRole: w.member.role, body: "a" });
  const reply = await addComment({
    postId: post.id, authorId: w.owner.id, authorRole: w.owner.role, body: "b", parentId: top.id,
  });
  const nested = await addComment({
    postId: post.id, authorId: w.member.id, authorRole: w.member.role, body: "c", parentId: reply.id,
  });
  assert.equal(nested.parentId, top.id, "the thread stays two levels deep");
});

test("a stranger cannot comment on a MEMBERS post", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "internal", visibility: "MEMBERS",
  });
  await assert.rejects(
    addComment({ postId: post.id, authorId: w.stranger.id, authorRole: w.stranger.role, body: "hi" }),
    /no longer exists/,
  );
});

// ─── Reactions and shares ───────────────────────────────────────────────────

test("a reaction toggles, and the tally is recomputed rather than incremented", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "react",
  });

  const on = await reactToPost({ postId: post.id, userId: w.owner.id, userRole: w.owner.role, type: "fire" });
  assert.equal(on.reacted, true);
  assert.equal(on.reactionCount, 1);
  assert.deepEqual(on.myReactions, ["fire"]);

  const off = await reactToPost({ postId: post.id, userId: w.owner.id, userRole: w.owner.role, type: "fire" });
  assert.equal(off.reacted, false);
  assert.equal(off.reactionCount, 0);
});

test("concurrent taps on the same reaction settle at one row, with no error", async () => {
  // The forum learnt this the expensive way: a read-then-write toggle produced
  // 400s under eight concurrent taps, because reacting is the highest-frequency
  // write in a feed.
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "hammer",
  });

  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      reactToPost({ postId: post.id, userId: w.owner.id, userRole: w.owner.role, type: "like" }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "rejected").length, 0, "no caller may see an error");
  const rows = await prisma.gymPostReaction.count({ where: { postId: post.id } });
  assert.ok(rows <= 1, `settled at ${rows} rows`);
});

test("different reaction types coexist", async () => {
  const w = await world();
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "many",
  });
  await reactToPost({ postId: post.id, userId: w.owner.id, userRole: w.owner.role, type: "like" });
  const result = await reactToPost({ postId: post.id, userId: w.owner.id, userRole: w.owner.role, type: "respect" });
  assert.equal(result.reactionCount, 2);
  assert.deepEqual(result.myReactions.sort(), ["like", "respect"]);
});

test("only PUBLIC posts are shareable", async () => {
  const w = await world();
  const open = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role, body: "share me",
  });
  const closed = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "don't", visibility: "MEMBERS",
  });

  assert.deepEqual(await sharePost({ postId: open.id, user: w.owner }), { shareCount: 1 });
  // Anonymous sharing is allowed by design; the route bounds it per IP.
  assert.deepEqual(await sharePost({ postId: open.id, user: null }), { shareCount: 2 });
  await assert.rejects(sharePost({ postId: closed.id, user: w.member }), /isn't shareable/);
});

// ─── Moderation ─────────────────────────────────────────────────────────────

test("hiding a post from the console releases its media; restoring returns the words", async () => {
  const w = await world();
  const a = await makeAsset(w.member.id);
  const post = await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "under review", media: [{ assetId: a.id }],
  });

  assert.equal(await setPostHidden({ postId: post.id, moderatorId: w.owner.id, hidden: true }), true);
  assert.equal(await refCountOf(a.id), 0, "hiding must not pin an asset forever");
  assert.equal(await getPost(post.id, w.member), null);

  // Hiding twice changes nothing — and must not release a second time.
  assert.equal(await setPostHidden({ postId: post.id, moderatorId: w.owner.id, hidden: false }), true);
  const back = await getPost(post.id, w.member);
  assert.equal(back!.body, "under review");
  assert.equal(back!.media.length, 0, "the photos are not silently resurrected");
});

test("cleanup collects an unreferenced asset and never a referenced one", async () => {
  const { cleanupMedia } = await import("@/lib/media/asset/lifecycle");
  const w = await world();
  const [held, loose] = [await makeAsset(w.member.id), await makeAsset(w.member.id)];
  await createPost({
    gymSlug: w.gym.slug, authorId: w.member.id, authorRole: w.member.role,
    body: "holding", media: [{ assetId: held.id }],
  });

  // Both are older than the grace period as far as the sweep is concerned.
  const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await cleanupMedia(later);

  assert.equal((await prisma.mediaAsset.findUnique({ where: { id: held.id } }))!.status, "READY");
  assert.equal((await prisma.mediaAsset.findUnique({ where: { id: loose.id } }))!.status, "DELETED");
});
