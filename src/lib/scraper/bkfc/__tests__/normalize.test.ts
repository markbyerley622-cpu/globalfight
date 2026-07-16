// Unit tests for the pure normalization helpers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHumanDate,
  parseRecord,
  parseEventNumber,
  parseLengthCm,
  parseStance,
  deriveEventStatus,
  deriveWinnerCorner,
  parseMethod,
  extractYouTubeId,
  socialPlatform,
  slugFromUrl,
  splitLocation,
} from "../normalize";

test("parseHumanDate handles BKFC date strings", () => {
  assert.equal(parseHumanDate("Feb 15, 2020"), "2020-02-15T00:00:00.000Z");
  assert.equal(parseHumanDate("September 27, 2025"), "2025-09-27T00:00:00.000Z");
});

test("parseHumanDate rejects yearless / garbage", () => {
  assert.equal(parseHumanDate("Feb 15"), null);
  assert.equal(parseHumanDate("soon"), null);
  assert.equal(parseHumanDate(null), null);
});

test("parseRecord reads visible number cells and ignores blanks", () => {
  assert.deepEqual(parseRecord(["2", "1", "0"]), { wins: 2, losses: 1, draws: 0, noContests: 0 });
  assert.deepEqual(parseRecord(["29", "23"]), { wins: 29, losses: 23, draws: 0, noContests: 0 });
  assert.equal(parseRecord(["5"]), null); // need at least W and L
});

test("parseEventNumber extracts the BKFC number", () => {
  assert.equal(parseEventNumber("BKFC 10 Lombard vs. Mundell"), 10);
  assert.equal(parseEventNumber("BKFC KnuckleMania"), null);
});

test("parseLengthCm understands imperial/metric/metres", () => {
  assert.equal(parseLengthCm("75in / 190cm"), 190);
  assert.equal(parseLengthCm("74 in"), 188);
  assert.equal(parseLengthCm("1.8288"), 183);
  assert.equal(parseLengthCm(null), null);
});

test("parseStance maps known stances", () => {
  assert.equal(parseStance("Southpaw"), "SOUTHPAW");
  assert.equal(parseStance("orthodox fighter"), "ORTHODOX");
  assert.equal(parseStance("unknown"), null);
});

test("deriveEventStatus reads dates and labels", () => {
  const now = new Date("2026-07-16T00:00:00Z");
  assert.equal(deriveEventStatus("2020-02-15T00:00:00.000Z", null, now), "COMPLETED");
  assert.equal(deriveEventStatus("2027-01-01T00:00:00.000Z", null, now), "SCHEDULED");
  assert.equal(deriveEventStatus("2027-01-01T00:00:00.000Z", "Cancelled", now), "CANCELLED");
  assert.equal(deriveEventStatus(null, null, now), "ANNOUNCED");
});

test("deriveWinnerCorner", () => {
  assert.equal(deriveWinnerCorner("win", "lose"), "red");
  assert.equal(deriveWinnerCorner("lose", "win"), "blue");
  assert.equal(deriveWinnerCorner("draw", "draw"), null);
  assert.equal(deriveWinnerCorner(null, null), null);
});

test("parseMethod maps finish text, else null", () => {
  assert.equal(parseMethod("TKO (punches)"), "TKO");
  assert.equal(parseMethod("Unanimous Decision"), "UD");
  assert.equal(parseMethod("Submission"), "SUB");
  assert.equal(parseMethod("mystery"), null);
});

test("extractYouTubeId across url shapes", () => {
  assert.equal(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("https://bkfc.com/x"), null);
});

test("socialPlatform classification", () => {
  assert.equal(socialPlatform("https://instagram.com/bkfc"), "instagram");
  assert.equal(socialPlatform("https://x.com/bkfc"), "twitter");
  assert.equal(socialPlatform("https://example.com"), null);
});

test("slugFromUrl takes the last path segment", () => {
  assert.equal(slugFromUrl("https://www.bkfc.com/fighters/aaron-chalmers"), "aaron-chalmers");
  assert.equal(slugFromUrl("https://www.bkfc.com/events/bkfc-10-lombard-vs-mundell/"), "bkfc-10-lombard-vs-mundell");
});

test("splitLocation", () => {
  assert.deepEqual(splitLocation("Greater Fort Lauderdale Convention Center, Fort Lauderdale, FL"), {
    city: "Fort Lauderdale",
    country: "FL",
  });
  assert.deepEqual(splitLocation(null), { city: null, country: null });
});
