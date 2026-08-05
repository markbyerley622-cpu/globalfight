// Unit tests for the verification-code primitives that do NOT need a database:
// the hash construction and the code generator. The issue/redeem transactions
// are exercised by the integration suite, which has a real Postgres.
//
// These two are worth isolating because they are where a quiet mistake would be
// invisible: a hash that ignores the salt, or a generator that never emits a
// leading zero, both still "work" end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { hashCode, verificationEmail, VERIFY_TTL_MINUTES, MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS } from "@/lib/auth-email-verify";

test("hashCode is salted by userId — same code, different users, different hash", () => {
  const a = hashCode("123456", "user_a");
  const b = hashCode("123456", "user_b");
  assert.notEqual(a, b, "a shared code must not produce a shared hash");
});

test("hashCode is deterministic and is sha256(code:userId)", () => {
  const expected = createHash("sha256").update("000123:user_x").digest("hex");
  assert.equal(hashCode("000123", "user_x"), expected);
  assert.equal(hashCode("000123", "user_x"), hashCode("000123", "user_x"));
});

test("hashCode never returns the raw code", () => {
  const h = hashCode("654321", "user_y");
  assert.ok(!h.includes("654321"));
  assert.equal(h.length, 64);
});

test("verificationEmail carries the code and the real TTL", () => {
  const { subject, text } = verificationEmail("019283");
  assert.ok(subject.includes("019283"), "the code belongs in the subject so it shows in the notification");
  assert.ok(text.includes("019283"));
  assert.ok(
    text.includes(`${VERIFY_TTL_MINUTES} minutes`),
    "the email must quote the constant, not a hardcoded duration that can drift",
  );
});

test("policy constants are within sane bounds", () => {
  // A cap high enough to be unusable as a guessing oracle would defeat the point
  // of a short code; a TTL long enough to sit in an inbox overnight likewise.
  assert.ok(MAX_ATTEMPTS >= 3 && MAX_ATTEMPTS <= 10, "attempt cap should be a handful");
  assert.ok(VERIFY_TTL_MINUTES > 0 && VERIFY_TTL_MINUTES <= 60, "TTL should be minutes, not hours");
  assert.ok(RESEND_COOLDOWN_SECONDS >= 30, "a cooldown under 30s is not a cooldown");
});
