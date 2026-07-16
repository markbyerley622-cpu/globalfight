// Parser tests against REAL captured BKFC HTML (see ./fixtures). These lock in
// the Webflow selector contract and prove resilience to missing fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseEventPage } from "../extract/events";
import { parseFighterPage } from "../extract/fighters";
import { parseRankingsPage } from "../extract/rankings";
import { parseArticlePage } from "../extract/news";
import { parseVideos } from "../extract/videos";

const DIR = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(DIR, "fixtures", name), "utf8");

test("parseFighterPage extracts identity, record and stats", () => {
  const f = parseFighterPage(fixture("fighter.html"), "https://www.bkfc.com/fighters/aaron-chalmers");
  assert.equal(f?.slug, "aaron-chalmers");
  assert.ok(f && f.name.length > 0);
  assert.ok(f?.record, "record parsed");
  assert.equal(f?.record?.wins, 2);
  assert.equal(f?.record?.losses, 1);
  assert.equal(f?.division, "Middleweight");
  assert.equal(f?.reachCm, 190); // "75in / 190cm"
});

test("parseEventPage extracts meta and a de-duplicated card", () => {
  const e = parseEventPage(
    fixture("event.html"),
    "https://www.bkfc.com/events/bkfc-10-lombard-vs-mundell",
    new Date("2026-07-16T00:00:00Z"),
  );
  assert.equal(e?.slug, "bkfc-10-lombard-vs-mundell");
  assert.match(e?.name ?? "", /BKFC 10/i);
  assert.equal(e?.number, 10);
  assert.equal(e?.status, "COMPLETED"); // 2020 event vs 2026 "now"
  assert.ok(e && e.date?.startsWith("2020-02-15"));
  assert.ok(e && e.venue && e.venue.length > 0);
  assert.ok(e && e.bouts.length > 0, "card parsed");
  // First bout is the main event with both corners resolved.
  const main = e!.bouts[0];
  assert.ok(main.mainEvent);
  assert.ok(main.redName && main.blueName);
  assert.notEqual(main.redName, main.blueName);
  // Results are intentionally null (not in static HTML).
  assert.equal(main.winnerCorner, null);
  assert.equal(main.method, null);
  // No duplicate bouts survive the responsive de-dupe.
  const keys = e!.bouts.map((b) => `${b.redSlug}|${b.blueSlug}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("parseRankingsPage yields divisions with ranked rows", () => {
  const rows = parseRankingsPage(fixture("rankings.html"));
  assert.ok(rows.length > 10, "many ranked rows");
  const divisions = new Set(rows.map((r) => r.division));
  assert.ok(divisions.has("Heavyweight"));
  // Every row is well-formed.
  for (const r of rows) {
    assert.ok(r.division.length > 0);
    assert.ok(r.fighterName.length > 0);
    assert.ok(r.rank >= 0);
  }
});

test("parseArticlePage extracts title, date and body", () => {
  const a = parseArticlePage(
    fixture("news.html"),
    "https://www.bkfc.com/news/15-bkfc-stars-predict-saturdays-main-event",
  );
  assert.equal(a?.slug, "15-bkfc-stars-predict-saturdays-main-event");
  assert.match(a?.title ?? "", /predict/i);
  assert.ok(a && a.publishedAt?.startsWith("2024-11-06"));
  assert.ok(a && a.content && a.content.length > 100);
});

test("parseVideos pulls YouTube ids, deduped", () => {
  const html = `
    <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="A"></iframe>
    <a href="https://youtu.be/dQw4w9WgXcQ">dup</a>
    <a href="https://www.youtube.com/watch?v=abcdefghijk">B</a>`;
  const vids = parseVideos(html);
  assert.equal(vids.length, 2);
  assert.equal(vids[0].youtubeId, "dQw4w9WgXcQ");
});

// ── Resilience ─────────────────────────────────────────────────────────────

test("parsers survive empty / broken HTML without throwing", () => {
  assert.equal(parseFighterPage("", "https://www.bkfc.com/fighters/x")?.slug, "x");
  assert.equal(parseEventPage("<html><body>x</body></html>", "https://www.bkfc.com/events/y")?.bouts.length, 0);
  assert.deepEqual(parseRankingsPage("<html></html>"), []);
  assert.equal(parseVideos("<html></html>").length, 0);
});

test("parsers reject an unusable URL (no slug)", () => {
  assert.equal(parseFighterPage(fixture("fighter.html"), "not a url"), null);
});
