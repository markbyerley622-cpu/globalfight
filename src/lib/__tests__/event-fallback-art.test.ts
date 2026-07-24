import { test } from "node:test";
import assert from "node:assert/strict";
import { eventFallbackArt } from "../event-fallback-art";

test("deterministic: same slug → same art", () => {
  assert.equal(eventFallbackArt("ufc-300", "#d20a0a"), eventFallbackArt("ufc-300", "#d20a0a"));
});
test("unique: different slugs → different art", () => {
  const a = eventFallbackArt("ufc-300", "#d20a0a");
  const b = eventFallbackArt("one-fight-night-99", "#d20a0a");
  const c = eventFallbackArt("bkfc-99", "#d20a0a");
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});
test("uses the promotion accent + a dark base, valid CSS layers", () => {
  const art = eventFallbackArt("x", "#e8112d");
  assert.ok(art.includes("#e8112d"));
  assert.ok(art.includes("radial-gradient"));
  assert.ok(art.includes("#0b0e13"));
});
test("empty slug is handled", () => {
  assert.ok(eventFallbackArt("", "#fff").length > 0);
});
