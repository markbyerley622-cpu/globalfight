import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerEntity } from "../registry";
import type { RichEntity } from "../types";

// ════════════════════════════════════════════════════════════════════════════
//  RESOLUTION — the moment a client's claim becomes stored identity.
//
//  This is the security boundary of the whole entity platform. Everything
//  downstream (rendering, linking, previewing, notifying) trusts what comes out
//  of here, so everything hostile has to be stopped here:
//
//    · a client naming a row by ID rather than by key
//    · a client attaching a real row to a span over somebody else's words
//    · a client referencing a row it is not allowed to see
//    · a selection that was valid when the menu was drawn and is not now
//    · autocomplete data that is simply stale or malformed
//
//  None of these may throw. Autocomplete goes out of date constantly, and a 500
//  because a fighter was renamed between the menu opening and the post being
//  sent would be absurd. Every one of them degrades the span to plain text.
//
//  ── How this runs without a database ──────────────────────────────────────
//  The source registry is the seam. A fake source is registered for a synthetic
//  kind and the real resolver — the one every surface calls — is driven against
//  it. That tests the LOGIC that is actually shipped, rather than a
//  reimplementation of it, and it is only possible because resolution is
//  registry-driven rather than a switch.
// ════════════════════════════════════════════════════════════════════════════

type Resolve = typeof import("../server")["resolveDraftEntities"];
type Hydrate = typeof import("../server")["hydrateEntities"];

let resolveDraftEntities: Resolve;
let hydrateEntities: Hydrate;

/** Rows the fake source will admit to knowing. key → (id, display name). */
const ROWS = new Map<string, { id: string; name: string }>([
  ["alex-pereira", { id: "ftr_1", name: "Alex Pereira" }],
  ["ufc-322", { id: "evt_1", name: "UFC 322" }],
  // The shapes gyms and promotions introduce, each of which broke a different
  // assumption the handle-only pipeline made:
  ["city-kickboxing", { id: "gym_1", name: "City Kickboxing" }],   // multi-word
  ["ufc", { id: "promo_1", name: "UFC" }],                          // very short
  ["10th-planet", { id: "gym_2", name: "10th Planet Jiu-Jitsu" }],  // digits + hyphen
  ["team-alpha", { id: "gym_3", name: "Team Alpha (MMA)" }],        // brackets
  ["academia-jose", { id: "gym_4", name: "Academia José Aldo" }],   // accented
]);

/** Keys the fake source can see but this VIEWER may not — a draft event. */
const HIDDEN = new Set(["secret-card"]);

let resolveCalls: string[][] = [];

before(async () => {
  registerEntity({
    kind: "testkind",
    label: "test row",
    labelPlural: "Test rows",
    tone: "org",
    markShape: "square",
    href: (e) => (e.hint?.slug ? `/t/${e.hint.slug}` : null),
    unavailable: "gone",
    previewable: true,
  });

  const { registerEntitySource } = await import("../server/registry");
  registerEntitySource({
    kind: "testkind",
    async resolve(keys) {
      // Recorded so the batching claim can be asserted rather than assumed.
      resolveCalls.push([...keys].sort());
      const out = new Map<string, { id: string; hint: { slug: string; name: string }; expect: string }>();
      for (const key of keys) {
        if (HIDDEN.has(key)) continue;
        const row = ROWS.get(key);
        if (!row) continue;
        out.set(key, {
          id: row.id,
          hint: { slug: key, name: row.name },
          expect: `@${row.name}`,
        });
      }
      return out;
    },
    async hydrate(ids) {
      const out = new Map<string, { slug: string; name: string }>();
      for (const [key, row] of ROWS) {
        if (ids.includes(row.id)) out.set(row.id, { slug: key, name: row.name });
      }
      return out;
    },
    async preview() { return []; },
  });

  ({ resolveDraftEntities, hydrateEntities } = await import("../server"));
});

beforeEach(() => { resolveCalls = []; });

const draft = (key: string, start: number, end: number) =>
  ({ type: "testkind", key, start, end });

describe("a well-formed selection resolves", () => {
  test("the span becomes an entity carrying the SERVER's id and hint", async () => {
    const text = "I think @Alex Pereira wins";
    const out = await resolveDraftEntities(text, [draft("alex-pereira", 8, 21)]);

    assert.equal(out.length, 1);
    assert.equal(out[0].type, "testkind");
    // The id came from the source, never from the request.
    assert.equal(out[0].id, "ftr_1");
    assert.equal(out[0].hint?.slug, "alex-pereira");
    assert.equal(out[0].hint?.name, "Alex Pereira");
  });

  test("two kinds in one body resolve together", async () => {
    const text = "@Alex Pereira fights at @UFC 322 next";
    const out = await resolveDraftEntities(text, [
      draft("alex-pereira", 0, 13),
      draft("ufc-322", 24, 32),
    ]);
    assert.deepEqual(out.map((e) => e.id), ["ftr_1", "evt_1"]);
  });

  test("ONE query per kind, however many entities the body carries", async () => {
    const text = "@Alex Pereira and @Alex Pereira and @UFC 322";
    await resolveDraftEntities(text, [
      draft("alex-pereira", 0, 13),
      draft("alex-pereira", 18, 31),
      draft("ufc-322", 36, 44),
    ]);
    // One call for the kind, with the keys DEDUPED — not one call per span.
    assert.equal(resolveCalls.length, 1);
    assert.deepEqual(resolveCalls[0], ["alex-pereira", "ufc-322"]);
  });
});

describe("what a client cannot do", () => {
  test("a client-supplied ID is not accepted as a key", async () => {
    // The whole invariant: the browser holds slugs and handles, never primary
    // keys. Posting the id back must not resolve, or the key/id split would be
    // decorative.
    const text = "@Alex Pereira wins";
    const out = await resolveDraftEntities(text, [
      { type: "testkind", key: "ftr_1", start: 0, end: 13 },
    ]);
    assert.deepEqual(out, []);
  });

  test("a span over SOMEBODY ELSE'S words is refused", async () => {
    // The attack this check exists for: attach a real row to a span covering
    // text the author never selected. It would render, link and preview.
    const text = "I hate this whole sport honestly";
    const out = await resolveDraftEntities(text, [draft("alex-pereira", 7, 20)]);
    assert.deepEqual(out, [], "an entity was attached to unrelated words");
  });

  test("a row the viewer may not see does not resolve", async () => {
    const text = "@Secret Card is coming";
    const out = await resolveDraftEntities(text, [draft("secret-card", 0, 12)]);
    assert.deepEqual(out, [], "a hidden row was referable");
  });

  test("a key that does not exist degrades to plain text", async () => {
    const text = "@Nobody At All here";
    const out = await resolveDraftEntities(text, [draft("nobody-at-all", 0, 14)]);
    assert.deepEqual(out, []);
  });

  test("the WRONG kind for a key is refused", async () => {
    // "alex-pereira" is a real key — for a kind whose source is registered.
    // Claimed under an unregistered kind it must resolve to nothing rather than
    // falling through to whichever source happens to know the key.
    const text = "@Alex Pereira wins";
    const out = await resolveDraftEntities(text, [
      { type: "not-a-registered-kind", key: "alex-pereira", start: 0, end: 13 },
    ]);
    assert.deepEqual(out, []);
  });
});

describe("stale autocomplete degrades, it never throws", () => {
  test("a row renamed after the menu was drawn is dropped", async () => {
    // The span still reads the OLD name, so the words no longer say what the
    // entity says. Storing it would link the wrong text to a real row.
    const text = "@Alex Pereria wins"; // note the typo: not the stored name
    const out = await resolveDraftEntities(text, [draft("alex-pereira", 0, 13)]);
    assert.deepEqual(out, []);
  });

  test("offsets past the end of the text are dropped", async () => {
    const text = "short";
    const out = await resolveDraftEntities(text, [draft("alex-pereira", 0, 9999)]);
    assert.deepEqual(out, []);
  });

  test("malformed drafts are skipped, and the good ones still resolve", async () => {
    const text = "@Alex Pereira wins";
    const out = await resolveDraftEntities(text, [
      null,
      "not an object",
      { type: "testkind" },
      { type: "testkind", key: "x", start: 5, end: 2 },
      { key: "alex-pereira", start: 0, end: 13 },
      draft("alex-pereira", 0, 13),
    ]);
    assert.equal(out.length, 1, "one bad draft took the good one down with it");
    assert.equal(out[0].id, "ftr_1");
  });

  test("a key with hostile characters never reaches the database", async () => {
    const text = "@Alex Pereira wins";
    await resolveDraftEntities(text, [
      { type: "testkind", key: "'; DROP TABLE users;--", start: 0, end: 13 },
    ]);
    // Rejected by the key pattern BEFORE any source is called, so the query is
    // never issued at all rather than relying on the ORM to escape it.
    assert.deepEqual(resolveCalls, []);
  });

  test("nothing at all is a no-op, not an error", async () => {
    assert.deepEqual(await resolveDraftEntities("hello", undefined), []);
    assert.deepEqual(await resolveDraftEntities("hello", []), []);
    assert.deepEqual(await resolveDraftEntities("hello", "garbage"), []);
  });
});

describe("the shapes gyms and promotions introduce", () => {
  test("a MULTI-WORD name resolves as one span", async () => {
    const text = "training at @City Kickboxing tomorrow";
    const out = await resolveDraftEntities(text, [draft("city-kickboxing", 12, 28)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "gym_1");
  });

  test("a VERY SHORT name resolves — and only over its own span", async () => {
    // "@UFC" is three characters. The span check has to accept it exactly and
    // reject a span that runs on into the next word.
    const text = "the @UFC card was good";
    assert.equal((await resolveDraftEntities(text, [draft("ufc", 4, 8)])).length, 1);
    assert.deepEqual(await resolveDraftEntities(text, [draft("ufc", 4, 13)]), []);
  });

  test("DIGITS and hyphens in a name resolve", async () => {
    const text = "@10th Planet Jiu-Jitsu is close by";
    const out = await resolveDraftEntities(text, [draft("10th-planet", 0, 22)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "gym_2");
  });

  test("BRACKETS in a name resolve — the span is compared literally", async () => {
    // Nothing here treats the expected text as a pattern, so "(MMA)" is matched
    // as characters rather than as a group.
    const text = "@Team Alpha (MMA) are hosting";
    const out = await resolveDraftEntities(text, [draft("team-alpha", 0, 17)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "gym_3");
  });

  test("ACCENTED characters resolve, and case still does not matter", async () => {
    const text = "@Academia José Aldo is legendary";
    assert.equal((await resolveDraftEntities(text, [draft("academia-jose", 0, 19)])).length, 1);

    const shouty = "@ACADEMIA JOSÉ ALDO is legendary";
    assert.equal(
      (await resolveDraftEntities(shouty, [draft("academia-jose", 0, 19)])).length, 1,
      "an accented name stopped matching when case changed",
    );
  });

  test("a gym and a promotion coexist with a person in one body", async () => {
    //  "@City Kickboxing fight at @UFC 322 — @Alex Pereira"
    const text = "@City Kickboxing fight at @UFC 322 — @Alex Pereira";
    const out = await resolveDraftEntities(text, [
      draft("city-kickboxing", 0, 16),
      draft("ufc-322", 26, 34),
      draft("alex-pereira", 37, 50),
    ]);
    assert.deepEqual(out.map((e) => e.id), ["gym_1", "evt_1", "ftr_1"]);
  });

  test("a span mismatch on a multi-word name degrades to plain text", async () => {
    // One word of the gym's name edited after picking. The words no longer say
    // what the entity says, so the entity goes rather than the words.
    const text = "training at @City Kickboxin tomorrow";
    assert.deepEqual(await resolveDraftEntities(text, [draft("city-kickboxing", 12, 27)]), []);
  });
});

describe("legacy drafts still resolve", () => {
  test("`username` is accepted where `key` is expected", async () => {
    // Every composer that shipped before this sent { type, username }. Tabs
    // holding that bundle are still writing content, so the field name has to
    // keep working — dropping it would silently downgrade their mentions.
    const text = "@Alex Pereira wins";
    const out = await resolveDraftEntities(text, [
      { type: "testkind", username: "alex-pereira", start: 0, end: 13 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "ftr_1");
  });
});

describe("hydration refreshes what resolution froze", () => {
  test("a stored id gets TODAY's slug and name", async () => {
    const stored: RichEntity[] = [{
      type: "testkind",
      id: "ftr_1",
      start: 0,
      end: 13,
      // Deliberately stale — the row has since been renamed.
      hint: { slug: "old-slug", name: "Old Name" },
    }];
    const [out] = await hydrateEntities([{ text: "@Alex Pereira wins", entities: stored }]);

    assert.equal(out[0].hint?.slug, "alex-pereira", "a re-slug did not reach historical content");
    assert.equal(out[0].hint?.name, "Alex Pereira");
  });

  test("a row that has GONE keeps its span but loses its link", async () => {
    const stored: RichEntity[] = [{
      type: "testkind",
      id: "deleted_row",
      start: 0,
      end: 13,
      hint: { slug: "was-here", name: "Was Here" },
    }];
    const [out] = await hydrateEntities([{ text: "@Alex Pereira wins", entities: stored }]);

    assert.equal(out.length, 1, "the span was deleted from a sentence written around it");
    // No routing key — the renderer reads that as "draw the words, do not link".
    assert.equal(out[0].hint?.slug, undefined);
    // The NAME survives, so the card and the aria-label still say something.
    assert.equal(out[0].hint?.name, "Was Here");
  });
});
