// ONE Championship parser + mapping tests against real captured HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseOneEventPage, detectOneSport } from "../extract/events";
import { validateOneEvent } from "../validate";
import { toNormalizedOneEvent } from "../map";

const DIR = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(join(DIR, "fixtures", n), "utf8");

test("detectOneSport routes Friday Fights to Muay Thai", () => {
  assert.equal(detectOneSport("one-friday-fights-172", "ONE Friday Fights 172"), "MUAY_THAI");
  assert.equal(detectOneSport("one-kickboxing-x", "ONE Kickboxing"), "KICKBOXING");
  assert.equal(detectOneSport("onefightnight50", "ONE Fight Night 50"), "MMA");
});

test("parseOneEventPage reads JSON-LD event (date/venue/location/sport)", () => {
  const e = parseOneEventPage(
    fixture("event.html"),
    "https://www.onefc.com/events/one-friday-fights-172/",
    new Date("2026-07-16T00:00:00Z"),
  );
  assert.equal(e?.slug, "one-friday-fights-172");
  assert.match(e?.name ?? "", /Friday Fights 172/);
  assert.ok(e && e.date?.startsWith("2026-09-25")); // ISO datetime kept
  assert.equal(e?.venue, "Lumpinee Stadium");
  assert.equal(e?.city, "Bangkok");
  assert.equal(e?.country, "TH");
  assert.equal(e?.sport, "MUAY_THAI");
  assert.equal(e?.status, "SCHEDULED"); // future date
});

test("validate + map to canonical NormalizedEvent", () => {
  const e = parseOneEventPage(fixture("event.html"), "https://www.onefc.com/events/one-friday-fights-172/")!;
  assert.equal(validateOneEvent(e).ok, true);
  const n = toNormalizedOneEvent(e, "2026-07-16T00:00:00.000Z");
  assert.equal(n.sport, "MUAY_THAI");
  assert.equal(n.promotion, "ONE Championship");
  assert.equal(n.countryCode, "TH"); // 2-letter code → countryCode
  assert.equal(n._meta.source, "one");
  assert.deepEqual(n.fights, []);
});

test("parser is resilient to empty HTML / bad url", () => {
  assert.equal(parseOneEventPage("<html></html>", "https://www.onefc.com/events/x/")?.slug, "x");
  assert.equal(parseOneEventPage(fixture("event.html"), "not a url"), null);
});
