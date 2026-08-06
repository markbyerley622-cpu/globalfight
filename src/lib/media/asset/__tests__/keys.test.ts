import { test } from "node:test";
import assert from "node:assert/strict";
import { newMediaKey, variantKey, zoneOf, assertPublicKey } from "@/lib/media/asset/keys";

test("keys are namespaced by zone", () => {
  assert.match(newMediaKey("temp", "image/jpeg"), /^media\/temp\//);
  assert.match(newMediaKey("quarantine", "image/png"), /^media\/quarantine\//);
  assert.match(newMediaKey("public", "image/webp"), /^media\/public\//);
});

test("keys are unguessable and never sequential", () => {
  // A sequential key lets anyone enumerate the store.
  const keys = new Set(Array.from({ length: 200 }, () => newMediaKey("public", "image/jpeg")));
  assert.equal(keys.size, 200, "200 keys should all be distinct");
  const stem = [...keys][0].split("/").pop()!.split(".")[0];
  assert.equal(stem.length, 32, "128 bits of randomness");
});

test("the key is NOT the content hash", () => {
  // Using the hash as the key would mean anyone holding a copy of a file can
  // derive the URL of every other upload of it.
  const a = newMediaKey("public", "image/jpeg");
  const b = newMediaKey("public", "image/jpeg");
  assert.notEqual(a, b, "identical inputs must not produce identical keys");
});

test("extension comes from the SNIFFED mime, never a filename", () => {
  assert.match(newMediaKey("public", "image/jpeg"), /\.jpg$/);
  assert.match(newMediaKey("public", "image/png"), /\.png$/);
  assert.match(newMediaKey("public", "image/webp"), /\.webp$/);
  // An unknown type cannot smuggle an executable extension through.
  assert.match(newMediaKey("public", "application/x-msdownload"), /\.bin$/);
});

test("zoneOf identifies each namespace", () => {
  assert.equal(zoneOf(newMediaKey("temp", "image/jpeg")), "temp");
  assert.equal(zoneOf(newMediaKey("quarantine", "image/jpeg")), "quarantine");
  assert.equal(zoneOf(newMediaKey("public", "image/jpeg")), "public");
  assert.equal(zoneOf("something/else/x.jpg"), null);
});

test("assertPublicKey REFUSES temp and quarantine keys", () => {
  // The code boundary that stops a URL ever being minted for unscanned or
  // infected bytes.
  assert.throws(() => assertPublicKey(newMediaKey("temp", "image/jpeg")), /non-public/);
  assert.throws(() => assertPublicKey(newMediaKey("quarantine", "image/jpeg")), /non-public/);
  assert.throws(() => assertPublicKey("media/../public/x.jpg"), /non-public/);
  assert.doesNotThrow(() => assertPublicKey(newMediaKey("public", "image/jpeg")));
});

test("variant keys stay in the public zone", () => {
  const base = newMediaKey("public", "image/jpeg");
  const v = variantKey(base, "thumb");
  assert.equal(zoneOf(v), "public");
  assert.match(v, /_thumb\.jpg$/);
  assert.doesNotThrow(() => assertPublicKey(v));
});

test("keys are date-sharded so a lifecycle rule can be a prefix scan", () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(newMediaKey("temp", "image/jpeg").includes(`/${today}/`));
});
