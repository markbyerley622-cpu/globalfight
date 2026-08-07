import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readMentionToken, applyMention } from "@/lib/mentions";

/** Read the token at the END of `text`, the common case while typing. */
const at = (text: string) => readMentionToken(text, text.length);

describe("readMentionToken — when the picker opens", () => {
  test("a handle at the start of the box", () => {
    assert.deepEqual(at("@dav"), { text: "dav", start: 0, end: 4 });
  });

  test("a handle mid-sentence", () => {
    const t = at("tell @dav");
    assert.deepEqual(t, { text: "dav", start: 5, end: 9 });
  });

  test("a bare @ opens the picker with no query", () => {
    // This is the useful empty state: it lists the people you follow before a
    // single character is typed. `+` instead of `{0,30}` would break it.
    assert.deepEqual(at("@"), { text: "", start: 0, end: 1 });
  });

  test("uses the SAME alphabet as the renderer and the notifier", () => {
    // Underscores and digits are in; dots and hyphens are not, because the
    // signup validator does not allow them. A wider alphabet here would
    // complete "@bob.smith", which RICH_TEXT_TOKEN would then highlight as only
    // "@bob" and extractMentions would ping as a user that does not exist.
    assert.equal(at("@a_b1")?.text, "a_b1");
    // The dot ENDS the handle, and the "@" is then no longer adjacent to what
    // follows — so the menu closes and stays closed, rather than reopening on
    // the tail. That is the behaviour we want: "@bob.smith" is not a handle.
    assert.equal(at("@bob.smith"), null);
    assert.equal(at("@bob-smith"), null);
  });

  test("opens after an opening bracket", () => {
    assert.equal(at("(@dav")?.text, "dav");
  });
});

describe("readMentionToken — when it must NOT open", () => {
  test("an email address", () => {
    // The one that matters. Without the word-boundary guard, typing an address
    // into a message pops a people picker over the domain.
    assert.equal(at("mail bob@gmail"), null);
    assert.equal(at("bob@gmail.com"), null);
  });

  test("after the space that ends the handle", () => {
    // This is what CLOSES the menu. There is no dismiss logic anywhere — the
    // pattern simply stops matching, so nothing can be left stale.
    assert.equal(at("@dave "), null);
    assert.equal(at("@dave hello"), null);
  });

  test("plain text with no @ at all", () => {
    assert.equal(at("hello there"), null);
    assert.equal(at(""), null);
  });

  test("a handle longer than any real username", () => {
    assert.equal(at(`@${"a".repeat(31)}`), null);
  });

  test("text after the caret is ignored", () => {
    // Editing an existing sentence: only what is LEFT of the caret is the
    // handle being typed.
    const text = "hi @dav and everyone";
    assert.equal(readMentionToken(text, 7)?.text, "dav");
  });

  test("a caret in the middle of a finished handle does not reopen it", () => {
    // Deliberate: clicking back into a handle you already completed should not
    // pop a picker over text you are done with.
    assert.equal(readMentionToken("@dave hello", 11), null);
  });

  test("out-of-range carets are clamped rather than throwing", () => {
    assert.equal(readMentionToken("@dav", 999)?.text, "dav");
    assert.equal(readMentionToken("@dav", -5), null);
  });
});

describe("applyMention", () => {
  test("replaces the fragment and leaves a trailing space", () => {
    const token = at("tell @dav")!;
    assert.deepEqual(applyMention("tell @dav", token, "davemma"), {
      text: "tell @davemma ",
      caret: 14,
    });
  });

  test("preserves text after the caret and puts the caret before it", () => {
    const text = "hi @dav and everyone";
    const token = readMentionToken(text, 7)!;
    const out = applyMention(text, token, "davemma");
    assert.equal(out.text, "hi @davemma  and everyone");
    // Caret sits right after the inserted space, NOT at the end of the box —
    // the reader carries on where they were.
    assert.equal(out.caret, 12);
    assert.equal(out.text.slice(0, out.caret), "hi @davemma ");
  });

  test("the result no longer matches, so the menu closes by itself", () => {
    const token = at("@dav")!;
    const out = applyMention("@dav", token, "davemma");
    assert.equal(readMentionToken(out.text, out.caret), null);
  });
});
