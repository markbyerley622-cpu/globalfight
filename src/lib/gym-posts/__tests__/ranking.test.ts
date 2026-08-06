// Feed ranking tests. Pure — no database, no clock, no randomness.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { scorePost, rankFeed, diversify, contentKeyOf, WEIGHTS, type Rankable } from "../ranking";

const NOW = new Date("2026-08-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const post = (over: Partial<Rankable> = {}): Rankable => ({
  id: "p1",
  gymId: "g1",
  createdAt: hoursAgo(1),
  reactionCount: 0,
  commentCount: 0,
  shareCount: 0,
  mediaCount: 0,
  widestMedia: 0,
  authorReputation: 0,
  contentKey: "",
  ...over,
});

describe("scoring", () => {
  it("gives a brand-new post with nothing on it a non-zero score", () => {
    // The bootstrap case. Without the leading 1 in the formula an unengaged
    // post scores zero and can never surface, which is what makes a new gym's
    // feed look abandoned no matter how much they post.
    assert.ok(scorePost(post(), NOW) > 0);
  });

  it("decays with age", () => {
    const fresh = scorePost(post({ createdAt: hoursAgo(1) }), NOW);
    const stale = scorePost(post({ createdAt: hoursAgo(72) }), NOW);
    assert.ok(fresh > stale, "a day-old post must not outrank an hour-old one on nothing");
  });

  it("treats everything inside the age floor as equally fresh", () => {
    // Two posts a minute apart in a busy hour should not be separated by
    // seconds of age — otherwise a feed becomes a race to post first.
    const a = scorePost(post({ createdAt: hoursAgo(0) }), NOW);
    const b = scorePost(post({ createdAt: hoursAgo(0.02) }), NOW);
    assert.ok(Math.abs(a - b) / a < 0.02);
  });

  it("weighs a share above a comment above a reaction", () => {
    const base = post();
    const reacted = scorePost({ ...base, reactionCount: 1 }, NOW);
    const commented = scorePost({ ...base, commentCount: 1 }, NOW);
    const shared = scorePost({ ...base, shareCount: 1 }, NOW);
    assert.ok(commented > reacted);
    assert.ok(shared > commented);
  });

  it("compresses engagement so a viral post cannot own the feed forever", () => {
    // The step from 3 reactions to 6 must be worth MORE than 300 to 306 — that
    // is what log compression buys, and it is why an old hit does not sit on
    // top of everything new.
    const at = (n: number) => scorePost(post({ reactionCount: n }), NOW);
    assert.ok(at(6) - at(3) > at(306) - at(300));
  });

  it("rewards having media, and rewards media that will render well", () => {
    const none = scorePost(post(), NOW);
    const small = scorePost(post({ mediaCount: 1, widestMedia: 400 }), NOW);
    const large = scorePost(post({ mediaCount: 1, widestMedia: 2000 }), NOW);
    assert.ok(small > none);
    assert.ok(large > small);
  });

  it("treats unknown dimensions as small rather than as no media", () => {
    // An asset processed before dimensions were recorded reports 0×0. It should
    // still count as a photo post; it just does not earn the quality bonus.
    const unknown = scorePost(post({ mediaCount: 1, widestMedia: 0 }), NOW);
    assert.ok(unknown > scorePost(post(), NOW));
    assert.ok(unknown < scorePost(post({ mediaCount: 1, widestMedia: 2000 }), NOW));
  });

  it("lets reputation break a tie but never manufacture reach", () => {
    // The entire spread from a new account to the highest-reputation member on
    // the platform must be worth less than a couple of real comments. A feed
    // where reputation outranks engagement is a leaderboard.
    const nobody = scorePost(post(), NOW);
    const legend = scorePost(post({ authorReputation: 100_000 }), NOW);
    const twoComments = scorePost(post({ commentCount: 2 }), NOW);
    assert.ok(legend > nobody, "reputation is a tiebreaker...");
    assert.ok(legend < twoComments, "...and nothing more");
    assert.equal(WEIGHTS.reputation < WEIGHTS.comment, true);
  });

  it("does not invert on a future-dated post", () => {
    // Clock skew between app instances produces these. A negative age would
    // invert the decay and pin the row to the top of the feed permanently.
    const future = scorePost(post({ createdAt: new Date(NOW.getTime() + 86_400_000) }), NOW);
    const now = scorePost(post({ createdAt: NOW }), NOW);
    assert.equal(future, now);
  });
});

describe("determinism", () => {
  it("returns the identical order for the identical input", () => {
    const posts = Array.from({ length: 30 }, (_, i) =>
      post({
        id: `p${i}`,
        gymId: `g${i % 4}`,
        createdAt: hoursAgo(i),
        reactionCount: (i * 7) % 13,
        commentCount: i % 5,
      }),
    );
    const a = rankFeed(posts, { now: NOW }).map((p) => p.id);
    const b = rankFeed([...posts], { now: NOW }).map((p) => p.id);
    assert.deepEqual(a, b);
  });

  it("breaks an exact score tie by a stable rule, not by sort order", () => {
    // Two identical posts have identical scores AND identical timestamps, so
    // the comparator must fall through to id. Without that last step the sort
    // is not a total order and either arrangement is legal — which is exactly
    // the non-determinism this module promises not to have.
    const shared = hoursAgo(3);
    const forwards = rankFeed(
      [post({ id: "b", gymId: "g1", createdAt: shared }), post({ id: "a", gymId: "g2", createdAt: shared })],
      { now: NOW },
    ).map((p) => p.id);
    const backwards = rankFeed(
      [post({ id: "a", gymId: "g2", createdAt: shared }), post({ id: "b", gymId: "g1", createdAt: shared })],
      { now: NOW },
    ).map((p) => p.id);
    assert.deepEqual(forwards, backwards);
    assert.deepEqual(forwards, ["a", "b"]);
  });
});

describe("duplicate suppression", () => {
  it("keeps the best-ranked copy of repeated content and drops the rest", () => {
    const ranked = rankFeed(
      [
        post({ id: "old", createdAt: hoursAgo(20), contentKey: "same" }),
        post({ id: "new", createdAt: hoursAgo(1), contentKey: "same" }),
      ],
      { now: NOW },
    );
    assert.deepEqual(ranked.map((p) => p.id), ["new"]);
  });

  it("never collapses posts that merely have no comparable content", () => {
    // An empty key means "nothing to compare", not "identical". Treating those
    // as duplicates would delete every media-only post but one.
    const ranked = rankFeed(
      [post({ id: "a", contentKey: "" }), post({ id: "b", contentKey: "" })],
      { now: NOW },
    );
    assert.equal(ranked.length, 2);
  });

  it("identifies content by text AND the SORTED asset set", () => {
    assert.equal(contentKeyOf("Open mat  Saturday", ["b", "a"]), contentKeyOf("open mat saturday", ["a", "b"]));
    assert.notEqual(contentKeyOf("open mat", ["a"]), contentKeyOf("open mat", ["a", "b"]));
    assert.equal(contentKeyOf("", []), "", "nothing to compare");
  });
});

describe("diversity", () => {
  it("breaks up a run from one gym", () => {
    const out = diversify([
      { gymId: "a", id: 1 }, { gymId: "a", id: 2 }, { gymId: "a", id: 3 }, { gymId: "b", id: 4 },
    ] as { gymId: string; id: number }[]);
    assert.deepEqual(out.map((r) => r.gymId), ["a", "b", "a", "a"]);
  });

  it("drops nothing — it reorders", () => {
    const input = Array.from({ length: 9 }, (_, i) => ({ gymId: i < 6 ? "a" : "b", id: i }));
    const out = diversify(input);
    assert.equal(out.length, input.length);
    assert.deepEqual(new Set(out.map((r) => r.id)), new Set(input.map((r) => r.id)));
  });

  it("gives up rather than showing nothing when one gym is all there is", () => {
    const input = Array.from({ length: 4 }, (_, i) => ({ gymId: "a", id: i }));
    assert.deepEqual(diversify(input).map((r) => r.id), [0, 1, 2, 3]);
  });

  it("is stable — the same input always produces the same interleave", () => {
    const input = [
      { gymId: "a", id: 1 }, { gymId: "a", id: 2 }, { gymId: "b", id: 3 },
      { gymId: "a", id: 4 }, { gymId: "c", id: 5 },
    ];
    assert.deepEqual(diversify(input), diversify([...input]));
  });

  it("leaves a single item alone", () => {
    assert.deepEqual(diversify([{ gymId: "a" }]), [{ gymId: "a" }]);
    assert.deepEqual(diversify([]), []);
  });
});
