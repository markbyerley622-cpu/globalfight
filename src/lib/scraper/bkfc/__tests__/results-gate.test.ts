// ════════════════════════════════════════════════════════════════════════════
//  The BKFC results feed is gated on COMPLIANCE, and this asserts the gate is
//  real rather than decorative.
//
//  It matters more than a normal flag test because of a trap in this codebase:
//  `isSourceEnabled()` in the ingestion registry has returned `true`
//  unconditionally since the 2026-08-01 gate removal. So the `bkfc-results`
//  registry entry's `enabled: false` stops NOTHING — the feature flag is the
//  only thing standing in front of the request. If someone "tidies up" by
//  deleting the flag check because the registry already says disabled, the
//  connector silently starts calling a third-party commercial vendor.
//
//  These tests fail if that happens.
// ════════════════════════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFlags } from "@/lib/feature-flags";
import { INGESTION_SOURCES, isSourceEnabled } from "@/lib/ingestion-registry";

/** A bare env for readFlags(). NODE_ENV is required by the ProcessEnv type only. */
const env = (v?: string): NodeJS.ProcessEnv =>
  ({ NODE_ENV: "test", ...(v === undefined ? {} : { BKFC_RESULTS_ENABLED: v }) }) as NodeJS.ProcessEnv;

test("the flag fails closed — only the exact string \"true\" enables it", () => {
  assert.equal(readFlags(env()).bkfcResultsEnabled, false, "unset must be off");
  for (const v of ["", "false", "TRUE", "True", "1", "yes", " true", "true "]) {
    assert.equal(
      readFlags(env(v)).bkfcResultsEnabled,
      false,
      `${JSON.stringify(v)} must not enable a compliance gate`,
    );
  }
  assert.equal(readFlags(env("true")).bkfcResultsEnabled, true);
});

test("the registry entry exists, is disabled, and claims no legal basis", () => {
  const entry = INGESTION_SOURCES.find((s) => s.id === "bkfc-results");
  assert.ok(entry, "bkfc-results must stay registered even while disabled");
  assert.equal(entry!.enabled, false);
  assert.equal(entry!.host, "xapi.mmareg.com", "a DIFFERENT host from every other bkfc-* entry");
  // A basis that does not say NONE/PENDING would be a false compliance claim.
  assert.match(entry!.basis, /NONE|PENDING/i);
});

test("the registry `enabled` field is NOT what gates this — the flag is", () => {
  // This asserts the trap itself, so the comment above can never drift from the
  // code: the registry says disabled, yet isSourceEnabled still returns true.
  const entry = INGESTION_SOURCES.find((s) => s.id === "bkfc-results")!;
  assert.equal(entry.enabled, false);
  assert.equal(
    isSourceEnabled("bkfc-results"),
    true,
    "isSourceEnabled is a no-op since 2026-08-01 — if this ever returns false the " +
      "registry gate was reinstated and the comments in sync.ts/feature-flags.ts need updating",
  );
});

test("strike statistics are not among the permitted fields", () => {
  const entry = INGESTION_SOURCES.find((s) => s.id === "bkfc-results")!;
  const joined = entry.permittedFields.join(" ").toLowerCase();
  for (const forbidden of ["strike", "punch", "knockdown", "landed"]) {
    assert.ok(!joined.includes(forbidden), `per-round ${forbidden} data must stay out of permittedFields`);
  }
});

test("the licensed fallback for BKFC results is still registered", () => {
  // The whole compliance decision rests on there being another way to get BKFC
  // results. If the Wikipedia path is ever removed, this decision needs revisiting.
  const wiki = INGESTION_SOURCES.find((s) => /wikipedia/i.test(s.id) && s.enabled);
  assert.ok(wiki, "a licensed results path must remain while bkfc-results is blocked");
});
