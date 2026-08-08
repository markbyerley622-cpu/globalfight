import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMention, readMentionToken } from "@/lib/mentions";

// ════════════════════════════════════════════════════════════════════════════
//  SELECTION — from what was typed, to what gets inserted, to what is sent.
//
//  The picker's own logic is deliberately pure and therefore testable without a
//  browser: reading the token under the caret, inserting the chosen text, and
//  scanning the FINAL text for what was inserted. Those three are where the
//  bugs live; the menu itself is markup.
//
//  ── Why the scan is the interesting part ─────────────────────────────────
//  Offsets are computed once, at submit, from the finished text — never
//  tracked per keystroke (see lib/composer/entities for why). That makes the
//  scan the only thing standing between a pick and a wrong span, and multi-word
//  inserts ("Alex Pereira", "UFC 322") broke every assumption the handle-only
//  version made.
// ════════════════════════════════════════════════════════════════════════════

// The pick registry is a hook, so its scan is exercised through the same pure
// helper the hook uses. Re-declared here rather than exported from the module,
// because exporting an internal for a test is how internals become API.
const WORD_CHAR = /[a-zA-Z0-9_]/;

function findInsertion(text: string, insert: string): [number, number][] {
  const needle = `@${insert}`;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerNeedle, from);
    if (at === -1) break;
    from = at + needle.length;
    const before = at > 0 ? text[at - 1] : "";
    if (before && WORD_CHAR.test(before)) continue;
    const after = text[from] ?? "";
    if (after && WORD_CHAR.test(after)) continue;
    out.push([at, from]);
  }
  return out;
}

describe("reading the token under the caret", () => {
  test("a bare @ opens the menu", () => {
    const token = readMentionToken("hey @", 5);
    assert.equal(token?.text, "");
  });

  test("a partial handle is the query", () => {
    assert.equal(readMentionToken("hey @ale", 8)?.text, "ale");
  });

  test("an email address does NOT open the menu", () => {
    assert.equal(readMentionToken("mail me at bob@gma", 18), null);
  });

  test("the menu closes once a space follows", () => {
    // This is what makes a multi-word insert terminate the picker: after
    // "@Alex " the pattern stops matching and no state has to be cleared.
    assert.equal(readMentionToken("hey @alex ", 10), null);
  });
});

describe("inserting the chosen text", () => {
  test("a handle is inserted with a trailing space", () => {
    const token = readMentionToken("hey @ale", 8)!;
    const { text, caret } = applyMention("hey @ale", token, "alex");
    assert.equal(text, "hey @alex ");
    assert.equal(caret, 10);
  });

  test("a MULTI-WORD name is inserted whole", () => {
    // A fighter inserts as their name, not their slug — "@alex-pereira" is a
    // URL, not something anybody writes in a sentence.
    const token = readMentionToken("I think @ale", 12)!;
    const { text } = applyMention("I think @ale", token, "Alex Pereira");
    assert.equal(text, "I think @Alex Pereira ");
  });

  test("inserting MID-SENTENCE keeps the tail and puts the caret after the pick", () => {
    const before = "I think @ale wins tonight";
    const token = readMentionToken(before, 12)!;
    const { text, caret } = applyMention(before, token, "Alex Pereira");
    assert.equal(text, "I think @Alex Pereira  wins tonight");
    assert.equal(caret, 22);
  });
});

describe("scanning the final text for what was picked", () => {
  test("a multi-word insert is found as ONE span", () => {
    assert.deepEqual(findInsertion("I think @Alex Pereira wins", "Alex Pereira"), [[8, 21]]);
  });

  test("a pick the author DELETED produces nothing", () => {
    assert.deepEqual(findInsertion("I think nobody wins", "Alex Pereira"), []);
  });

  test("a pick used TWICE produces two spans", () => {
    const spans = findInsertion("@Alex Pereira beat @Alex Pereira", "Alex Pereira");
    assert.equal(spans.length, 2);
  });

  test("an email address is never matched", () => {
    assert.deepEqual(findInsertion("write to bob@alex today", "alex"), []);
  });

  test("a PREFIX of a longer word is not matched", () => {
    // Picking "@Alex" must not claim the span of "@Alexander".
    assert.deepEqual(findInsertion("ask @Alexander about it", "Alex"), []);
  });

  test("case differences still match — a handle is not case-sensitive", () => {
    assert.deepEqual(findInsertion("ask @ALEX about it", "alex"), [[4, 9]]);
  });

  test("an insert containing punctuation is matched literally, not as a pattern", () => {
    // Event names carry dots, colons and brackets. Treating the insert as a
    // regex would either throw or match the wrong thing.
    assert.deepEqual(
      findInsertion("watching @UFC 322: Main Event tonight", "UFC 322: Main Event"),
      [[9, 29]],
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  THE ARCHITECTURE RULE: the Composer does not know what a fighter is.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the Composer contains no per-kind logic", () => {
  const FILES = [
    "components/composer/composer.tsx",
    "components/composer/suggestion-row.tsx",
    "lib/composer/entities.ts",
  ];

  test("no picker file names an entity kind", () => {
    // The rule the brief states outright, and the one that decays first: one
    // `if (kind === "fighter")` for an urgent case and the picker is no longer
    // extensible — the next kind then needs a second branch, and nothing fails.
    //
    // Everything kind-specific arrives as DATA: the server returns generic
    // suggestion fields, and the plugin supplies the group heading and the
    // tone. Adding "sponsor" touches none of these three files.
    const offenders: string[] = [];
    for (const rel of FILES) {
      const body = stripComments(readFileSync(join(SRC, rel), "utf8"));
      for (const kind of ["mention", "fighter", "event", "gym", "promotion"]) {
        if (body.includes(`"${kind}"`) || body.includes(`'${kind}'`)) {
          offenders.push(`${rel} names "${kind}"`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "The picker must ask the registry, never branch on a kind:\n" +
        offenders.map((o) => `  - ${o}`).join("\n"),
    );
  });

  test("the picker reads its labels and tones from the registry", () => {
    // The positive half: it is not enough to contain no kind names — a file
    // that hard-coded "People"/"Fighters" as headings would also pass the check
    // above while being exactly as unextensible.
    const body = readFileSync(join(SRC, "components/composer/composer.tsx"), "utf8");
    assert.ok(body.includes("entityPlugin("), "the Composer does not consult the registry");
    assert.ok(body.includes("labelPlural"), "group headings are not coming from the registry");
  });

  test("the guard is not vacuous — it can see a kind name", () => {
    assert.ok(stripComments('const k = "fighter";').includes('"fighter"'));
    assert.equal(stripComments('// fighter mentioned in prose').includes('"fighter"'), false);
  });
});
