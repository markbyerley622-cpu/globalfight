// Regression tests for two storage faults found during production verification.
// No network: both are decided before any SDK call.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { isObjectStorageConfigured } from "../store";

const KEYS = [
  "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL",
  "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL",
];
const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
const setR2 = (over: Record<string, string> = {}) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, {
    R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    R2_BUCKET: "globalfight-media",
    R2_ACCESS_KEY_ID: "a".repeat(32),
    R2_SECRET_ACCESS_KEY: "b".repeat(64),
    R2_PUBLIC_BASE_URL: "https://pub-x.r2.dev",
    ...over,
  });
};

describe("credential whitespace — REGRESSION", () => {
  // A trailing newline in R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY reached the
  // SigV4 signer and Node threw `Invalid character in header content
  // ["authorization"]` — naming neither the variable nor the cause. Observed in
  // the real production env: the key arrived 33 chars and the secret 65, each one
  // byte over, each a bare \n. Values must be trimmed before use.
  it("still counts configuration as present when values carry a newline", () => {
    setR2({ R2_ACCESS_KEY_ID: `${"a".repeat(32)}\n`, R2_SECRET_ACCESS_KEY: `${"b".repeat(64)}\n` });
    assert.equal(isObjectStorageConfigured(), true);
  });

  it("treats a whitespace-only value as absent, not as configured", () => {
    setR2({ R2_SECRET_ACCESS_KEY: "   \n  " });
    assert.equal(isObjectStorageConfigured(), false);
  });

  it("tolerates surrounding whitespace on every credential", () => {
    setR2({
      R2_ENDPOINT: "  https://acct.r2.cloudflarestorage.com \n",
      R2_BUCKET: "\tglobalfight-media\r\n",
      R2_PUBLIC_BASE_URL: " https://pub-x.r2.dev\n",
    });
    assert.equal(isObjectStorageConfigured(), true);
  });
});

describe("configured-backend detection — REGRESSION", () => {
  // putObject() swallowed every R2 error and fell through to local disk, so a bad
  // credential produced a cheerful "/fighters/<slug>/profile.webp" — a path that
  // exists only on the machine that ran the job. Over a backfill that is thousands
  // of rows pointing at files no deployed instance can serve, with no error
  // anywhere. This flag is what now stops that degradation.
  it("reports configured when every variable is present", () => {
    setR2();
    assert.equal(isObjectStorageConfigured(), true);
  });

  for (const missing of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL"]) {
    it(`reports NOT configured without ${missing} — local fallback stays legal for dev`, () => {
      setR2();
      delete process.env[missing];
      assert.equal(isObjectStorageConfigured(), false);
    });
  }

  it("accepts the S3_* spelling", () => {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, {
      S3_ENDPOINT: "https://s3.example", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s", S3_PUBLIC_BASE_URL: "https://cdn.example",
    });
    assert.equal(isObjectStorageConfigured(), true);
  });

  it("reports NOT configured when nothing is set at all", () => {
    for (const k of KEYS) delete process.env[k];
    assert.equal(isObjectStorageConfigured(), false);
  });
});
