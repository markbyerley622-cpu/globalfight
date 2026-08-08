import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { registerEntity, entityHref } from "../registry";
import { segmentBody } from "../segment";
import { sanitizeEntities, type RichEntity } from "../types";

// ════════════════════════════════════════════════════════════════════════════
//  BODIES THAT MIX EVERYTHING — the state the product is actually in.
//
//  Three generations of content now coexist, and they will for years:
//
//    legacy      "@alex" with NO entities column — parsed by the old regex
//    structured  a person, stored by id since the entity layer shipped
//    multi-kind  fighters and events, storable since the picker learned them
//
//  All three can appear in ONE body: somebody edits a two-year-old post and
//  adds a fighter to it. The rules that keep that coherent are subtle and every
//  one of them is load-bearing, so they are pinned here rather than left to the
//  segmenter's own unit tests, which only ever look at one generation at a time.
// ════════════════════════════════════════════════════════════════════════════

before(() => {
  // Registered so `fighter`/`event` are known kinds in this process even though
  // the plugin manifest is imported for its side effects elsewhere.
  for (const [kind, prefix] of [["fighter", "/fighters"], ["event", "/events"]] as const) {
    try {
      registerEntity({
        kind,
        label: kind,
        labelPlural: `${kind}s`,
        tone: "org",
        markShape: "square",
        href: (e) => (e.hint?.slug ? `${prefix}/${e.hint.slug}` : null),
        unavailable: "gone",
        previewable: true,
      });
    } catch {
      // Already registered by the real plugin manifest. Either way the kind
      // exists, which is all this suite needs.
    }
  }
});

const seg = (text: string, entities: unknown) => segmentBody(text, entities)[0];

describe("legacy content keeps working, untouched", () => {
  test("a body with NO entities is still parsed by the old regex", () => {
    const parts = seg("nice one @alex", null);
    const mention = parts.find((p) => p.kind === "entity");
    assert.ok(mention, "a legacy @handle stopped rendering as a mention");
    assert.equal(mention.kind === "entity" && mention.legacy, true);
    // No id: it can link by handle but cannot survive a rename or be previewed.
    assert.equal(mention.kind === "entity" && mention.entity.id, "");
  });

  test("a legacy mention still routes, by the handle frozen in the text", () => {
    const parts = seg("nice one @alex", null);
    const mention = parts.find((p) => p.kind === "entity");
    assert.equal(
      mention?.kind === "entity" ? entityHref(mention.entity) : null,
      "/u/alex",
    );
  });
});

describe("structured and multi-kind in one body", () => {
  //  "@Alex Pereira fights at @UFC 322, thoughts @dave?"
  //   0123456789...
  const TEXT = "@Alex Pereira fights at @UFC 322, thoughts @dave?";
  const ENTITIES: RichEntity[] = [
    { type: "fighter", id: "ftr_1", start: 0, end: 13, hint: { slug: "alex-pereira", name: "Alex Pereira" } },
    { type: "event", id: "evt_1", start: 24, end: 32, hint: { slug: "ufc-322", name: "UFC 322" } },
    { type: "mention", id: "usr_1", start: 43, end: 48, hint: { username: "dave", name: "Dave" } },
  ];

  test("all three kinds survive sanitisation", () => {
    const out = sanitizeEntities(ENTITIES, TEXT);
    assert.deepEqual(out.map((e) => e.type), ["fighter", "event", "mention"]);
  });

  test("the segmenter emits three entity spans over the right words", () => {
    const parts = seg(TEXT, ENTITIES);
    const chips = parts.filter((p) => p.kind === "entity");
    assert.equal(chips.length, 3);
    assert.deepEqual(
      chips.map((c) => (c.kind === "entity" ? c.text : "")),
      ["@Alex Pereira", "@UFC 322", "@dave"],
    );
  });

  test("every kind routes through ITS OWN plugin", () => {
    const parts = seg(TEXT, ENTITIES);
    const hrefs = parts
      .filter((p) => p.kind === "entity")
      .map((p) => (p.kind === "entity" ? entityHref(p.entity) : null));

    assert.deepEqual(hrefs, ["/fighters/alex-pereira", "/events/ufc-322", "/u/dave"]);
  });

  test("the text between the chips is preserved exactly", () => {
    const parts = seg(TEXT, ENTITIES);
    assert.equal(parts.map((p) => p.text).join(""), TEXT);
  });

  test("nothing is marked legacy — every span carries an id", () => {
    const parts = seg(TEXT, ENTITIES);
    for (const p of parts) {
      if (p.kind !== "entity") continue;
      assert.equal(p.legacy, false);
      assert.notEqual(p.entity.id, "");
    }
  });
});

describe("the precedence rule holds across kinds", () => {
  test("a structured body does NOT also run the mention regex", () => {
    // The rule that stops a body having both. A literal "@someone" that nobody
    // picked must stay plain text beside a real entity — otherwise it renders
    // highlighted, unlinked and un-notified, which is the "styled but inert"
    // failure the whole platform was built to remove.
    const text = "@Alex Pereira beat @nobodypickedthis";
    const parts = seg(text, [
      { type: "fighter", id: "ftr_1", start: 0, end: 13, hint: { slug: "alex-pereira", name: "Alex Pereira" } },
    ]);

    const chips = parts.filter((p) => p.kind === "entity");
    assert.equal(chips.length, 1, "the regex ran alongside structured entities");
    assert.ok(
      parts.some((p) => p.kind === "text" && p.text.includes("@nobodypickedthis")),
      "an unpicked handle was not left as plain text",
    );
  });

  test("overlapping spans across kinds resolve deterministically", () => {
    // A fighter "Alex" and a person "alex" can both match at the same offset.
    // Both cannot render; the earlier-and-longer span wins, and the loser is
    // dropped rather than double-rendering the same characters.
    const text = "@Alex Pereira wins";
    const out = sanitizeEntities(
      [
        { type: "fighter", id: "ftr_1", start: 0, end: 13, hint: { slug: "alex-pereira" } },
        { type: "mention", id: "usr_1", start: 0, end: 5, hint: { username: "alex" } },
      ],
      text,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "fighter");
  });
});

describe("a body written by an OLDER client still renders", () => {
  test("an unknown kind degrades to plain text rather than breaking the body", () => {
    // Forward compatibility: a server storing a kind this bundle has never
    // heard of must not produce a broken-looking post. The span is dropped and
    // the words render — exactly what legacy content already does.
    const text = "sponsored by @Monster tonight";
    const parts = seg(text, [
      { type: "a-kind-from-the-future", id: "x1", start: 13, end: 21, hint: { slug: "monster" } },
    ]);
    assert.equal(parts.map((p) => p.text).join(""), text, "text was lost");
    assert.equal(
      parts.filter((p) => p.kind === "entity" && !p.legacy).length,
      0,
      "an unrenderable kind produced a chip",
    );
  });
});
