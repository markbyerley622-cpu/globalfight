import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeEntities, mentionedUserIds, MAX_ENTITIES, type RichEntity } from "@/lib/rich-text/types";
import { segmentBody, segmentLine } from "@/lib/rich-text/segment";

const mention = (id: string, start: number, end: number, username?: string): RichEntity => ({
  type: "mention", id, start, end, hint: username ? { username } : undefined,
});

describe("sanitizeEntities — untrusted input is DROPPED, never trusted", () => {
  const text = "I think @alex wins this fight.";

  test("a well-formed entity survives", () => {
    const out = sanitizeEntities([mention("u1", 8, 13, "alex")], text);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "u1");
  });

  test("offsets past the end of the text are dropped", () => {
    // The exploit: an entity claiming 0..9999 makes a renderer slice past the
    // end and swallow the rest of the message.
    assert.deepEqual(sanitizeEntities([mention("u1", 8, 9999)], text), []);
  });

  test("zero-width and inverted spans are dropped", () => {
    assert.deepEqual(sanitizeEntities([mention("u1", 8, 8)], text), []);
    assert.deepEqual(sanitizeEntities([mention("u1", 13, 8)], text), []);
  });

  test("non-integer and negative offsets are dropped", () => {
    assert.deepEqual(sanitizeEntities([mention("u1", -1, 5)], text), []);
    assert.deepEqual(sanitizeEntities([{ ...mention("u1", 0, 5), start: 1.5 }], text), []);
  });

  test("unknown types are dropped", () => {
    assert.deepEqual(sanitizeEntities([{ ...mention("u1", 8, 13), type: "script" }], text), []);
  });

  test("a missing or oversized id is dropped", () => {
    assert.deepEqual(sanitizeEntities([{ ...mention("", 8, 13) }], text), []);
    assert.deepEqual(sanitizeEntities([{ ...mention("x".repeat(65), 8, 13) }], text), []);
  });

  test("garbage in is an empty list out, never a throw", () => {
    // Malformed entities reach this from a client request AND from a JSON
    // column written by older code. Throwing would turn one bad span into a
    // 500 for the whole message.
    for (const junk of [null, undefined, 42, "nope", {}, [null], [42], [{}]]) {
      assert.doesNotThrow(() => sanitizeEntities(junk, text));
      assert.deepEqual(sanitizeEntities(junk, text), []);
    }
  });

  test("overlapping entities keep the earlier one only", () => {
    // Two entities over the same characters cannot both render — the segmenter
    // would emit the span twice.
    const out = sanitizeEntities([mention("a", 8, 13), mention("b", 10, 16)], text);
    assert.deepEqual(out.map((e) => e.id), ["a"]);
  });

  test("output is sorted by start regardless of input order", () => {
    const out = sanitizeEntities([mention("b", 20, 25), mention("a", 0, 5)], text);
    assert.deepEqual(out.map((e) => e.id), ["a", "b"]);
  });

  test("the count is capped — one post must not ping a hundred people", () => {
    const many = Array.from({ length: 40 }, (_, i) => mention(`u${i}`, i * 2, i * 2 + 1));
    const long = "x".repeat(200);
    assert.equal(sanitizeEntities(many, long).length, MAX_ENTITIES);
  });

  test("a hint is optional and its junk fields are stripped", () => {
    const out = sanitizeEntities(
      [{ ...mention("u1", 8, 13), hint: { username: "alex", name: 42, evil: "x" } }],
      text,
    );
    // `slug` joins username and name in the envelope: mentions route on a
    // handle, every other kind routes on a slug. Absent here, but present as a
    // key — the sanitiser normalises the shape rather than omitting fields.
    assert.deepEqual(out[0].hint, { username: "alex", slug: undefined, name: undefined });
  });
});

describe("mentionedUserIds — what the notifier reads instead of a regex", () => {
  test("distinct mention ids only", () => {
    const ids = mentionedUserIds([
      mention("u1", 0, 5), mention("u1", 6, 10), mention("u2", 11, 15),
      { type: "event", id: "e1", start: 16, end: 20 },
    ]);
    assert.deepEqual(ids.sort(), ["u1", "u2"]);
  });

  test("no entities means nobody", () => {
    assert.deepEqual(mentionedUserIds([]), []);
  });
});

describe("segmentation — structured content", () => {
  const text = "I think @alex wins this fight.";

  test("a mention becomes an entity segment carrying its id", () => {
    const [line] = segmentBody(text, [mention("u1", 8, 13, "alex")]);
    const entity = line.find((s) => s.kind === "entity");
    assert.ok(entity && entity.kind === "entity");
    assert.equal(entity.text, "@alex");
    assert.equal(entity.entity.id, "u1");
    assert.equal(entity.legacy, false);
  });

  test("text around the entity survives intact", () => {
    const [line] = segmentBody(text, [mention("u1", 8, 13, "alex")]);
    assert.equal(line.map((s) => s.text).join(""), text);
  });

  test("ADJACENT mentions do not merge or lose a character", () => {
    const t = "@a @b";
    const [line] = segmentBody(t, [mention("u1", 0, 2), mention("u2", 3, 5)]);
    assert.equal(line.map((s) => s.text).join(""), t);
    assert.equal(line.filter((s) => s.kind === "entity").length, 2);
  });

  test("multiple lines keep their offsets — the +1 for the newline", () => {
    // The off-by-one this guards: forgetting the "\n" split() removed shifts
    // every entity on every line after the first.
    const t = "hi\n@alex there";
    const [, second] = segmentBody(t, [mention("u1", 3, 8, "alex")]);
    const entity = second.find((s) => s.kind === "entity");
    assert.ok(entity && entity.kind === "entity");
    assert.equal(entity.text, "@alex");
  });

  test("an entity spanning a line break is dropped rather than mis-sliced", () => {
    const t = "hi\nthere";
    const [first, second] = segmentBody(t, [mention("u1", 1, 5)]);
    assert.equal(first.concat(second).some((s) => s.kind === "entity"), false);
  });
});

describe("segmentation — legacy fallback", () => {
  test("no entities falls back to the parser", () => {
    const [line] = segmentBody("hey @alex", []);
    const entity = line.find((s) => s.kind === "entity");
    assert.ok(entity && entity.kind === "entity");
    assert.equal(entity.legacy, true, "a parsed mention must be marked legacy");
    assert.equal(entity.entity.id, "", "a parsed mention has no id — that is the point");
    assert.equal(entity.entity.hint?.username, "alex");
  });

  test("legacy URLs still become links", () => {
    const [line] = segmentBody("see https://example.com now", []);
    const link = line.find((s) => s.kind === "link");
    assert.ok(link && link.kind === "link");
    assert.equal(link.href, "https://example.com");
  });

  test("structured content does NOT also run the mention regex", () => {
    // The precedence that matters. If both ran, a literal "@ghost" nobody
    // picked would render highlighted, unlinked and un-notified beside a real
    // mention — the "styled but inert" bug the whole system exists to remove.
    const t = "@alex and @ghost";
    const [line] = segmentBody(t, [mention("u1", 0, 5, "alex")]);
    const entities = line.filter((s) => s.kind === "entity");
    assert.equal(entities.length, 1);
    assert.equal(line.map((s) => s.text).join(""), t);
  });

  test("links are STILL detected in the gaps between structured entities", () => {
    const t = "@alex see https://x.com";
    const [line] = segmentBody(t, [mention("u1", 0, 5, "alex")]);
    assert.ok(line.some((s) => s.kind === "link"), "a URL beside a mention must still link");
  });
});

describe("segmentation — hostile and degenerate input", () => {
  test("empty text produces one empty line, not a crash", () => {
    assert.doesNotThrow(() => segmentBody("", []));
  });

  test("malformed stored entities degrade to legacy, not to a broken render", () => {
    const t = "hey @alex";
    const [line] = segmentBody(t, [{ type: "mention", id: "u1", start: 999, end: 1000 }]);
    // Every entity was dropped, so the body is treated as legacy content.
    assert.equal(line.map((s) => s.text).join(""), t);
    const entity = line.find((s) => s.kind === "entity");
    assert.ok(entity && entity.kind === "entity" && entity.legacy);
  });

  test("text is never lost, whatever the entities claim", () => {
    // The invariant a renderer depends on: concatenating the segments always
    // reproduces the line exactly. Anything else silently eats somebody's words.
    const cases: [string, unknown][] = [
      ["plain text", []],
      ["@a", [mention("u", 0, 2)]],
      ["a @b c", [mention("u", 2, 4)]],
      ["@a@b", [mention("u", 0, 2), mention("v", 2, 4)]],
      ["trailing @x ", [mention("u", 9, 11)]],
      ["weird", [{ nonsense: true }]],
    ];
    for (const [text, entities] of cases) {
      const joined = segmentBody(text, entities).map((l) => l.map((s) => s.text).join("")).join("\n");
      assert.equal(joined, text, `segments lost text for: ${JSON.stringify(text)}`);
    }
  });

  test("segmentLine tolerates entities belonging to another line", () => {
    const out = segmentLine("hello", [mention("u1", 100, 105)], 0);
    assert.equal(out.map((s) => s.text).join(""), "hello");
  });
});
