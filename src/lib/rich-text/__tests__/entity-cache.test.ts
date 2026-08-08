import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  subscribeEntity, prefetchEntity, peekEntity, seedEntity,
  resetEntityCache, entityCacheSize, type EntityState,
} from "../cache";

// ════════════════════════════════════════════════════════════════════════════
//  THE CACHE'S PROMISES, tested as promises rather than as implementation.
//
//  Each of these is a claim the hover system depends on, and each fails
//  SILENTLY if it breaks — the UI still works, it just issues ten requests
//  where it used to issue one, or holds every person named in an infinite feed
//  until the tab is closed. Nothing in a browser tells you that is happening.
// ════════════════════════════════════════════════════════════════════════════

interface Call { body: { entities: { type: string; id: string }[] } }

let calls: Call[] = [];
let respond: (ids: { type: string; id: string }[]) => unknown[];

const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  // Default: echo back a preview for everything asked for.
  respond = (ids) => ids.map((e) => ({ kind: e.type, id: e.id, name: `name-${e.id}` }));
  resetEntityCache();

  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Call["body"];
    calls.push({ body });
    return {
      ok: true,
      json: async () => ({ previews: respond(body.entities) }),
    };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  resetEntityCache();
  globalThis.fetch = originalFetch;
});

/** Let the 0ms batch timer fire and its promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 5));

const mention = (id: string) => ({ type: "mention", id });

describe("request deduplication", () => {
  test("five chips for ONE person issue ONE request", async () => {
    // The stated requirement, and the reason the cache exists at all: a thread
    // where one person is named five times must not cost five lookups.
    const states: EntityState[] = [];
    const unsubs = Array.from({ length: 5 }, () =>
      subscribeEntity(mention("u1"), (s) => states.push(s)),
    );

    await settle();

    assert.equal(calls.length, 1, `expected 1 request, got ${calls.length}`);
    assert.deepEqual(calls[0].body.entities, [{ type: "mention", id: "u1" }]);
    // And every subscriber was told the answer.
    assert.equal(
      states.filter((s) => s.status === "ready").length, 5,
      "not every subscriber received the loaded state",
    );
    unsubs.forEach((u) => u());
  });

  test("different ids in the same tick leave as ONE batch", async () => {
    const unsubs = ["u1", "u2", "u3"].map((id) => subscribeEntity(mention(id), () => {}));
    await settle();

    assert.equal(calls.length, 1, "ids raised in one tick must batch into one request");
    assert.equal(calls[0].body.entities.length, 3);
    unsubs.forEach((u) => u());
  });

  test("a mixed batch keeps every kind", async () => {
    const unsubs = [
      subscribeEntity({ type: "mention", id: "u1" }, () => {}),
      subscribeEntity({ type: "gym", id: "g1" }, () => {}),
    ];
    await settle();

    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].body.entities.map((e) => e.type).sort(),
      ["gym", "mention"],
    );
    unsubs.forEach((u) => u());
  });
});

describe("caching and staleness", () => {
  test("a second subscriber after the answer lands fetches NOTHING", async () => {
    const a = subscribeEntity(mention("u1"), () => {});
    await settle();
    assert.equal(calls.length, 1);
    a();

    let seen: EntityState = { status: "idle" };
    const b = subscribeEntity(mention("u1"), (s) => { seen = s; });
    await settle();

    assert.equal(calls.length, 1, "a fresh entry must not refetch");
    // Served SYNCHRONOUSLY from cache — which is what makes a second hover of
    // the same person open with content instead of a spinner.
    assert.equal(seen.status, "ready");
    b();
  });

  test("prefetch warms the cache so a later subscribe is instant", async () => {
    prefetchEntity(mention("u1"));
    await settle();
    assert.equal(calls.length, 1);

    const states: EntityState[] = [];
    const unsub = subscribeEntity(mention("u1"), (s) => states.push(s));

    // The FIRST state a subscriber sees is already `ready` — no loading frame.
    // This is the whole point of prefetching on pointer-enter: by the time the
    // 180ms open delay elapses, the answer is here.
    assert.equal(states[0].status, "ready");
    assert.equal(calls.length, 1);
    unsub();
  });

  test("an id the server does not return is cached as missing, and not retried", async () => {
    respond = () => [];
    const a = subscribeEntity(mention("ghost"), () => {});
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(peekEntity(mention("ghost")).status, "missing");
    a();

    // Hovering a deleted account repeatedly must not re-ask forever.
    const b = subscribeEntity(mention("ghost"), () => {});
    await settle();
    assert.equal(calls.length, 1, "a missing entity was re-requested");
    b();
  });

  test("seed writes straight in — a surface that already holds the facts never fetches", async () => {
    seedEntity({ kind: "mention", id: "u9", name: "Already known" });

    const states: EntityState[] = [];
    const unsub = subscribeEntity(mention("u9"), (s) => states.push(s));
    await settle();

    assert.equal(calls.length, 0, "a seeded entity must not be fetched");
    const last = states[states.length - 1];
    assert.equal(last.status, "ready");
    assert.equal(last.status === "ready" && last.preview.name, "Already known");
    unsub();
  });
});

describe("failure and cancellation", () => {
  test("a failed request surfaces as error, not as a silent empty card", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;

    let seen: EntityState = { status: "idle" };
    const unsub = subscribeEntity(mention("u1"), (s) => { seen = s; });
    await settle();

    assert.equal(seen.status, "error");
    unsub();
  });

  test("the LAST subscriber leaving aborts the request", async () => {
    let aborted = false;
    globalThis.fetch = ((_url: string, init: { signal: AbortSignal; body: string }) => {
      init.signal.addEventListener("abort", () => { aborted = true; });
      // Never resolves on its own — the abort is the only way out, which is
      // exactly the slow-connection case this behaviour exists for.
      return new Promise(() => {});
    }) as unknown as typeof fetch;

    const unsub = subscribeEntity(mention("u1"), () => {});
    await settle();
    assert.equal(aborted, false, "aborted while still subscribed");

    unsub();
    assert.equal(aborted, true, "the request outlived its last subscriber");
    // And the entry is left clean rather than stuck loading, so the next hover
    // starts fresh instead of showing a spinner for a request nobody awaits.
    assert.equal(peekEntity(mention("u1")).status, "idle");
  });
});

describe("memory is bounded", () => {
  test("an endless feed cannot grow the cache without limit", async () => {
    // 400 distinct people, which is a plausible afternoon on an infinite feed.
    for (let i = 0; i < 400; i++) prefetchEntity(mention(`u${i}`));
    await settle();

    // The exact ceiling is an implementation detail; that there IS one is not.
    assert.ok(
      entityCacheSize() <= 200,
      `cache grew to ${entityCacheSize()} entries — the LRU ceiling is not holding`,
    );
  });

  test("an entry with a live subscriber is never evicted from under it", async () => {
    const unsub = subscribeEntity(mention("pinned"), () => {});
    await settle();

    for (let i = 0; i < 400; i++) prefetchEntity(mention(`filler${i}`));
    await settle();

    // Evicting an entity that is currently on screen would blank an open card
    // and immediately refetch it.
    assert.notEqual(
      peekEntity(mention("pinned")).status, "idle",
      "an entry with a live subscriber was evicted",
    );
    unsub();
  });
});

describe("the batch has a ceiling", () => {
  test("more than one request's worth is split, never dropped", async () => {
    for (let i = 0; i < 30; i++) prefetchEntity(mention(`u${i}`));
    await settle();
    await settle();

    const asked = calls.flatMap((c) => c.body.entities.map((e) => e.id));
    assert.ok(calls.length >= 2, "30 entities should not go out as one request");
    assert.equal(new Set(asked).size, 30, "entities were dropped rather than deferred");
    for (const c of calls) {
      assert.ok(c.body.entities.length <= 24, "a batch exceeded the server's cap");
    }
  });
});
