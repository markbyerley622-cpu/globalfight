import { test } from "node:test";
import assert from "node:assert/strict";
import { toCountryCode } from "../countries";

test("ISO-2 passes through, lowercased; uk → gb", () => {
  assert.equal(toCountryCode("US"), "us");
  assert.equal(toCountryCode("gb"), "gb");
  assert.equal(toCountryCode("UK"), "gb");
});

test("full ISO-3 table resolves (the cases that were blank boxes)", () => {
  assert.equal(toCountryCode("URY"), "uy"); // Uruguay
  assert.equal(toCountryCode("MDA"), "md"); // Moldova
  assert.equal(toCountryCode("TKM"), "tm"); // Turkmenistan
  assert.equal(toCountryCode("KAZ"), "kz");
  assert.equal(toCountryCode("USA"), "us");
  assert.equal(toCountryCode("GBR"), "gb");
  assert.equal(toCountryCode("BRA"), "br");
});

test("names and official long forms resolve, always lowercase", () => {
  assert.equal(toCountryCode("Uruguay"), "uy");
  assert.equal(toCountryCode("Moldova"), "md");
  assert.equal(toCountryCode("Republic of Moldova"), "md");
  assert.equal(toCountryCode("Great Britain"), "gb");
  assert.equal(toCountryCode("England"), "gb");
  assert.equal(toCountryCode("Korea"), "kr");
});

test("federation/sport aliases resolve (ROC, TPE)", () => {
  assert.equal(toCountryCode("ROC"), "ru");
  assert.equal(toCountryCode("TPE"), "tw");
});

test("unknown / empty → undefined (caller shows no flag)", () => {
  assert.equal(toCountryCode("xyz"), undefined);
  assert.equal(toCountryCode(""), undefined);
  assert.equal(toCountryCode(null), undefined);
});
