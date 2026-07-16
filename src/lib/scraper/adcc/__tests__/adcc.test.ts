// ADCC (BJJ) extractor + mapping tests against real captured HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAdccEventsPage } from "../extract";
import { toNormalizedAdccEvent } from "../map";

const DIR = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(DIR, "fixtures", "events.html"), "utf8");

test("parseAdccEventsPage extracts the events listing", () => {
  const ev = parseAdccEventsPage(html, new Date("2026-07-16T00:00:00Z"));
  assert.ok(ev.length >= 20, `expected many events, got ${ev.length}`);
  for (const e of ev) {
    assert.ok(e.slug && e.name, "slug + name present");
    assert.ok(e.date && e.date.startsWith("20"), "ISO date");
  }
  // No duplicate slugs.
  const slugs = ev.map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("maps to canonical NormalizedEvent (sport BJJ, promotion ADCC)", () => {
  const e = parseAdccEventsPage(html)[0];
  const n = toNormalizedAdccEvent(e, "2026-07-16T00:00:00.000Z");
  assert.equal(n.sport, "BJJ");
  assert.equal(n.promotion, "ADCC");
  assert.equal(n._meta.source, "adcc");
  assert.ok(n.name.length > 0);
  assert.deepEqual(n.fights, []);
});

test("resilient to empty HTML", () => {
  assert.deepEqual(parseAdccEventsPage("<html></html>"), []);
});
