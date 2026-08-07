import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeEntities } from "@/lib/rich-text/types";
import { segmentBody } from "@/lib/rich-text/segment";

// ════════════════════════════════════════════════════════════════════════════
//  The offset builder, and the migration behaviours the architecture promises.
//
//  The builder lives in a "use client" module behind a hook, so the SCAN is
//  re-implemented here in the shape the hook uses and exercised directly. That
//  is a real duplication and worth naming: what is being pinned is the RULE
//  (where a handle starts and ends), and if these two ever disagree the
//  entities will point at the wrong characters — which is exactly the class of
//  bug offset-tracking was rejected to avoid.
// ════════════════════════════════════════════════════════════════════════════

const BOUNDARY = /[a-zA-Z0-9_]/;

/** Mirrors findHandle in lib/composer/entities. */
function findHandle(text: string, handle: string): [number, number][] {
  const needle = `@${handle}`;
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = text.toLowerCase().indexOf(needle.toLowerCase(), from);
    if (at === -1) break;
    from = at + needle.length;
    const before = at > 0 ? text[at - 1] : "";
    if (before && BOUNDARY.test(before)) continue;
    const after = text[from] ?? "";
    if (after && BOUNDARY.test(after)) continue;
    out.push([at, from]);
  }
  return out;
}

describe("offsets are computed from the FINAL text", () => {
  // The property that makes offset tracking unnecessary: however the text was
  // edited — paste, undo, select-all-replace — the spans describe what is
  // actually there at submit, because nothing was remembered.

  test("finds a handle at the start, middle and end", () => {
    assert.deepEqual(findHandle("@alex wins", "alex"), [[0, 5]]);
    assert.deepEqual(findHandle("I think @alex wins", "alex"), [[8, 13]]);
    assert.deepEqual(findHandle("it's @alex", "alex"), [[5, 10]]);
  });

  test("a mention the author DELETED produces nothing", () => {
    assert.deepEqual(findHandle("changed my mind entirely", "alex"), []);
  });

  test("a mention the author DUPLICATED produces two", () => {
    assert.deepEqual(findHandle("@alex and @alex again", "alex"), [[0, 5], [10, 15]]);
  });

  test("an email address is not a mention", () => {
    // "mail bob@alex.com" must not mention alex.
    assert.deepEqual(findHandle("mail bob@alex", "alex"), []);
  });

  test("a longer handle is not matched by a shorter pick", () => {
    // Picking "@al" must not claim the span of "@alex" — the entity would cover
    // three characters of somebody else's handle.
    assert.deepEqual(findHandle("@alex", "al"), []);
  });

  test("matching is case-insensitive, because people type it however they like", () => {
    assert.deepEqual(findHandle("hey @Alex", "alex"), [[4, 9]]);
  });

  test("the computed span really is the handle", () => {
    // The invariant the server re-checks before trusting a draft.
    const text = "I think @alex wins";
    const [[start, end]] = findHandle(text, "alex");
    assert.equal(text.slice(start, end), "@alex");
  });
});

describe("username changes never orphan a historical mention", () => {
  // The headline requirement. The stored entity keeps its id; only the HINT
  // moves, and hydrate rewrites it on read. Simulated here by rewriting the
  // hint exactly as hydrateEntities does.

  const text = "I think @alex123 wins.";
  const stored = [{ type: "mention" as const, id: "usr_1", start: 8, end: 16, hint: { username: "alex123" } }];

  test("before the rename, the link points at the old handle", () => {
    const [line] = segmentBody(text, stored);
    const e = line.find((s) => s.kind === "entity");
    assert.ok(e && e.kind === "entity");
    assert.equal(e.entity.hint?.username, "alex123");
  });

  test("after the rename, the SAME stored row renders the new handle", () => {
    // hydrate re-stamps the hint from the user row. No stored content changed.
    const rehydrated = stored.map((e) => ({ ...e, hint: { username: "alex_pereira" } }));
    const [line] = segmentBody(text, rehydrated);
    const e = line.find((s) => s.kind === "entity");
    assert.ok(e && e.kind === "entity");
    assert.equal(e.entity.hint?.username, "alex_pereira");
    // The visible TEXT is unchanged — it is what the author wrote.
    assert.equal(e.text, "@alex123");
    // …and identity never moved.
    assert.equal(e.entity.id, "usr_1");
  });

  test("a LEGACY mention of the same person cannot follow the rename", () => {
    // The contrast that justifies the whole pass: with no id there is nothing
    // to re-resolve, so the handle is frozen at whatever was typed.
    const [line] = segmentBody(text, []);
    const e = line.find((s) => s.kind === "entity");
    assert.ok(e && e.kind === "entity");
    assert.equal(e.legacy, true);
    assert.equal(e.entity.id, "");
  });
});

describe("deleted and hidden users degrade safely", () => {
  test("a deleted user keeps the words but loses the link", () => {
    // hydrate clears the handle when the id resolves to nothing.
    const text = "thanks @ghost";
    const [line] = segmentBody(text, [
      { type: "mention", id: "usr_gone", start: 7, end: 13, hint: { username: undefined } },
    ]);
    const e = line.find((s) => s.kind === "entity");
    assert.ok(e && e.kind === "entity");
    assert.equal(e.entity.hint?.username, undefined);
    // The sentence was written around this — deleting the span would leave
    // "thanks ".
    assert.equal(line.map((s) => s.text).join(""), text);
  });
});

describe("the stored shape survives a round trip", () => {
  test("what resolve stores is what sanitize accepts", () => {
    // resolveDraftEntities runs sanitizeEntities before returning, so anything
    // in the database is already valid by the read path's own rules. This pins
    // that the two agree.
    const text = "cc @alex and @sam";
    const stored = sanitizeEntities(
      [
        { type: "mention", id: "u1", start: 3, end: 8, hint: { username: "alex", name: "Alex" } },
        { type: "mention", id: "u2", start: 13, end: 17, hint: { username: "sam", name: "Sam" } },
      ],
      text,
    );
    assert.equal(stored.length, 2);
    assert.deepEqual(sanitizeEntities(stored, text), stored, "re-sanitising stored entities must be a no-op");
  });
});
