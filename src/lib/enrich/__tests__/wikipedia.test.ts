import { test } from "node:test";
import assert from "node:assert/strict";
import { stripQuery } from "../wikipedia";

// ── Why this one line has its own test file ─────────────────────────────────
// The Commons licence lookup turns a photo URL into a `File:` title by taking
// the last path segment. PageImages started appending analytics parameters to
// every URL it returns:
//
//   …/commons/c/c2/Curtis_Blaydes_at_UFC_221.png?utm_source=en.wikipedia.org
//     &utm_campaign=api&utm_content=original
//
// so the lookup asked for a file called "Curtis_Blaydes_at_UFC_221.png?utm_…",
// found nothing, read no licence, and REJECTED the photo as unlicensed. The
// enrich cron kept reporting success — it had simply decided that every
// photograph on Wikimedia Commons was non-free. 6 fighters out of 10,748 had a
// face, and nothing anywhere said why.
//
// It is one `.split()`. It is also the entire fighter-photo pipeline.

const REAL = "https://upload.wikimedia.org/wikipedia/commons/c/c2/Curtis_Blaydes_at_UFC_221.png"
  + "?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=original";

test("strips the tracking parameters PageImages appends", () => {
  assert.equal(
    stripQuery(REAL),
    "https://upload.wikimedia.org/wikipedia/commons/c/c2/Curtis_Blaydes_at_UFC_221.png",
  );
});

test("the stripped URL yields the true Commons filename", () => {
  // This is the value that becomes the `File:` title. Getting it wrong is
  // indistinguishable from "the file is not freely licensed".
  assert.equal(decodeURIComponent(stripQuery(REAL).split("/").pop()!), "Curtis_Blaydes_at_UFC_221.png");
});

test("leaves a clean URL untouched", () => {
  const clean = "https://upload.wikimedia.org/wikipedia/commons/8/8d/Tyson_Fury.jpg";
  assert.equal(stripQuery(clean), clean);
});

test("drops a fragment as well as a query", () => {
  assert.equal(stripQuery("https://example.org/a/b/File.png#preview"), "https://example.org/a/b/File.png");
});

test("preserves percent-encoding in the path", () => {
  // Commons filenames routinely contain encoded commas and parentheses; the
  // strip must not touch anything before the "?".
  const url = "https://upload.wikimedia.org/wikipedia/commons/8/8d/Tyson_Fury_at_Place_Bell%2C_Laval_%28cropped%29.jpg?utm_source=x";
  assert.equal(
    stripQuery(url),
    "https://upload.wikimedia.org/wikipedia/commons/8/8d/Tyson_Fury_at_Place_Bell%2C_Laval_%28cropped%29.jpg",
  );
  assert.equal(
    decodeURIComponent(stripQuery(url).split("/").pop()!),
    "Tyson_Fury_at_Place_Bell,_Laval_(cropped).jpg",
  );
});
