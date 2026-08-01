// Storage configuration validation. No network, no SDK, no env mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateStorageConfiguration, assertStorageConfigured, describeStorage,
  resolveProviderName, StorageConfigurationError,
} from "../storage-config";
import { collectStartupProblems } from "../startup-guard";

/** A complete, usable public-bucket configuration. */
const GOOD_R2 = {
  STORAGE_PROVIDER: "r2",
  R2_BUCKET: "globalfight-media",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  // Distinctive on purpose: a one-character secret appears incidentally in any
  // output string, so the "never leaks" assertion below would pass vacuously.
  R2_ACCESS_KEY_ID: "AKIAZZEXAMPLEKEYID9",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMIsecretEXAMPLEKEY7",
  R2_PUBLIC_BASE_URL: "https://media.globalfight.app",
} as unknown as NodeJS.ProcessEnv;

describe("provider resolution", () => {
  it("maps r2 and s3 onto the same backend", () => {
    assert.equal(resolveProviderName({ STORAGE_PROVIDER: "r2" } as unknown as NodeJS.ProcessEnv), "s3");
    assert.equal(resolveProviderName({ STORAGE_PROVIDER: "s3" } as unknown as NodeJS.ProcessEnv), "s3");
  });

  it("defaults to url when unset — the documented local-dev mode", () => {
    assert.equal(resolveProviderName({} as unknown as NodeJS.ProcessEnv), "url");
    assert.equal(validateStorageConfiguration({} as unknown as NodeJS.ProcessEnv).usable, true);
  });

  it("treats an unrecognised value as url rather than guessing", () => {
    assert.equal(resolveProviderName({ STORAGE_PROVIDER: "gcs" } as unknown as NodeJS.ProcessEnv), "url");
  });
});

describe("validation — REGRESSION for the production configuration", () => {
  it("rejects STORAGE_PROVIDER=r2 with no R2_* variables", () => {
    // The exact production state: provider selected, nothing else set. The old
    // getStorage() returned a working-looking s3Provider for this.
    const diag = validateStorageConfiguration({ STORAGE_PROVIDER: "r2" } as unknown as NodeJS.ProcessEnv);
    assert.equal(diag.provider, "s3");
    assert.equal(diag.usable, false);
    assert.equal(diag.missing.length, 5, "every missing variable is reported, not just the first");
  });

  it("accepts a complete configuration", () => {
    const diag = validateStorageConfiguration(GOOD_R2);
    assert.equal(diag.usable, true);
    assert.deepEqual(diag.missing, []);
    assert.equal(diag.bucket, "globalfight-media");
    assert.equal(diag.endpointHost, "acct.r2.cloudflarestorage.com");
    assert.equal(diag.publicUrlConfigured, true);
  });

  it("accepts the S3_* spelling as an alternative", () => {
    const diag = validateStorageConfiguration({
      STORAGE_PROVIDER: "s3",
      S3_BUCKET: "b", S3_ENDPOINT: "https://e.example", S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s", S3_PUBLIC_BASE_URL: "https://cdn.example",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(diag.usable, true);
  });

  for (const missing of ["R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL"]) {
    it(`rejects a configuration missing ${missing}`, () => {
      const env = { ...GOOD_R2 };
      delete (env as Record<string, unknown>)[missing];
      const diag = validateStorageConfiguration(env);
      assert.equal(diag.usable, false);
      assert.ok(diag.missing.some((m) => m.includes(missing)), `${missing} must be named in the error`);
    });
  }

  it("treats an empty string as missing, not as set", () => {
    const diag = validateStorageConfiguration({ ...GOOD_R2, R2_BUCKET: "   " });
    assert.equal(diag.usable, false);
  });

  it("requires a public base URL — a stored object with no address is unusable", () => {
    const env = { ...GOOD_R2 };
    delete (env as Record<string, unknown>).R2_PUBLIC_BASE_URL;
    assert.equal(validateStorageConfiguration(env).usable, false);
  });

  it("reports an unparseable endpoint rather than throwing", () => {
    const diag = validateStorageConfiguration({ ...GOOD_R2, R2_ENDPOINT: "not a url" });
    assert.equal(diag.endpointHost, "(unparseable)");
  });

  it("validates supabase on its own variables", () => {
    assert.equal(validateStorageConfiguration({ STORAGE_PROVIDER: "supabase" } as unknown as NodeJS.ProcessEnv).usable, false);
    assert.equal(
      validateStorageConfiguration({
        STORAGE_PROVIDER: "supabase", SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_BUCKET: "b",
      } as unknown as NodeJS.ProcessEnv).usable,
      true,
    );
  });
});

describe("assertStorageConfigured", () => {
  it("throws a descriptive StorageConfigurationError naming the caller", () => {
    try {
      assertStorageConfigured("fighters/images", { STORAGE_PROVIDER: "r2" } as unknown as NodeJS.ProcessEnv);
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof StorageConfigurationError);
      assert.equal(e.requestedBy, "fighters/images");
      assert.match(e.message, /Selected provider: s3/);
      assert.match(e.message, /R2_BUCKET/);
      assert.match(e.message, /fighters\/images/);
      // It must steer the operator AWAY from the private bucket.
      assert.match(e.message, /EVIDENCE_R2/);
    }
  });

  it("does not throw for a complete configuration", () => {
    assert.doesNotThrow(() => assertStorageConfigured("fighters/images", GOOD_R2));
  });

  it("does not throw when no provider is selected", () => {
    assert.doesNotThrow(() => assertStorageConfigured("fighters/images", {} as unknown as NodeJS.ProcessEnv));
  });
});

describe("diagnostics never leak secrets", () => {
  it("reports the bucket and endpoint HOST, never keys or the full endpoint", () => {
    const line = describeStorage(validateStorageConfiguration(GOOD_R2));
    assert.match(line, /globalfight-media/);
    assert.match(line, /acct\.r2\.cloudflarestorage\.com/);
    assert.ok(!line.includes(GOOD_R2.R2_ACCESS_KEY_ID as string));
    assert.ok(!line.includes(GOOD_R2.R2_SECRET_ACCESS_KEY as string));
  });

  it("says plainly when storage is unusable", () => {
    assert.match(describeStorage(validateStorageConfiguration({ STORAGE_PROVIDER: "r2" } as unknown as NodeJS.ProcessEnv)), /UNUSABLE/);
  });

  it("says plainly when nothing is stored at all", () => {
    assert.match(describeStorage(validateStorageConfiguration({} as unknown as NodeJS.ProcessEnv)), /nothing is stored/);
  });
});

describe("startup guard integration", () => {
  it("refuses to start when the selected media bucket is unconfigured", () => {
    const problems = collectStartupProblems({ STORAGE_PROVIDER: "r2" } as unknown as NodeJS.ProcessEnv);
    assert.ok(
      problems.some((p) => p.includes("STORAGE_PROVIDER=r2") && p.includes("R2_BUCKET")),
      "the storage fault must be reported at boot",
    );
  });

  it("does not complain when storage is complete", () => {
    const problems = collectStartupProblems(GOOD_R2);
    assert.ok(!problems.some((p) => p.includes("STORAGE_PROVIDER")), problems.join(" | "));
  });

  it("still refuses to share a bucket with identity documents", () => {
    // The pre-existing guarantee must survive this change.
    const problems = collectStartupProblems({
      ...GOOD_R2, EVIDENCE_R2_BUCKET: "globalfight-media",
    });
    assert.ok(problems.some((p) => /must not be the same bucket/i.test(p)));
  });
});
