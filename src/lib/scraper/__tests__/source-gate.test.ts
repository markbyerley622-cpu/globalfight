// ════════════════════════════════════════════════════════════════════════════
//  The outbound compliance boundary.
//
//  These tests exist because `enabled: false` used to mean "fetch it, then throw
//  the result away". The invariant now under test is the stronger one:
//
//      disabled source → the request is never made
//
//  from cron, CLI, backfill and dry runs alike.
// ════════════════════════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gateDecision,
  assertFetchAllowed,
  declaredHosts,
  effectiveEnabled,
  SourceDisabledError,
} from "../source-gate";
import { INGESTION_SOURCES } from "@/lib/ingestion-registry";

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ NODE_ENV: "test", ...extra }) as NodeJS.ProcessEnv;

// ── THE CASE THIS WAS BUILT FOR ────────────────────────────────────────────

test("MMAReg is unreachable while bkfc-results is disabled", () => {
  const url = "https://xapi.mmareg.com/api/bkfc?type=json&modifier=event-stats&id=312";
  const d = gateDecision(url, env());
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "all-sources-disabled");
  assert.deepEqual(d.sources, ["bkfc-results"]);
  assert.throws(() => assertFetchAllowed(url, env()), SourceDisabledError);
});

test("a refusal is distinguishable from an outage", () => {
  // A compliance decision must not look like a network error, or it gets
  // "fixed" by adding a retry.
  try {
    assertFetchAllowed("https://xapi.mmareg.com/api/bkfc", env());
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof SourceDisabledError);
    assert.match((e as Error).message, /compliance gate, not an outage/);
  }
});

test("the flag alone re-opens MMAReg — registry and flag are AND-ed", () => {
  // bkfc-results is registry-disabled AND flag-off. Prove the flag is a real
  // veto rather than decoration by checking it independently.
  assert.equal(effectiveEnabled("bkfc-results", env()), false);
  assert.equal(effectiveEnabled("bkfc-results", env({ BKFC_RESULTS_ENABLED: "true" })), false,
    "registry entry is disabled, so the flag alone must NOT be sufficient");
});

// ── ENFORCEMENT, NOT ACTIVATION ────────────────────────────────────────────

test("hosts with a live source stay reachable", () => {
  // bkfc.com is claimed by bkfc-events (on) and bkfc-news (off). At least one
  // is live, so the host is allowed — this change must not switch off working
  // ingestion as a side effect of hardening.
  for (const url of [
    "https://www.bkfc.com/events/bkfc-10-lombard-vs-mundell",
    "https://www.onefc.com/events/one-friday-fights-165/",
    "https://en.wikipedia.org/wiki/ONE_Friday_Fights_46",
    "https://adcombat.com/events/",
  ]) {
    const d = gateDecision(url, env());
    assert.equal(d.allowed, true, `${url} → ${d.reason} (${d.sources.join(",")})`);
  }
});

test("an unregistered host is allowed but flagged, not silently blocked", () => {
  const d = gateDecision("https://site.espn.com/mma/scoreboard", env());
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "no-registered-source");
  assert.deepEqual(d.sources, []);
});

test("subdomains inherit their parent's registration", () => {
  // xapi.mmareg.com is registered explicitly; this proves the suffix rule too,
  // so a vendor cannot be reached by moving to api2.<same-domain>.
  assert.equal(gateDecision("https://deep.sub.xapi.mmareg.com/x", env()).allowed, false);
});

test("an unparseable URL is not turned into a compliance error", () => {
  const d = gateDecision("not a url", env());
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "unparseable-url");
});

// ── THE HOST FIELD IS HUMAN PROSE ──────────────────────────────────────────

test("declaredHosts reads hostnames and ignores prose", () => {
  assert.deepEqual(declaredHosts("bkfc.com, youtube.com"), ["bkfc.com", "youtube.com"]);
  assert.deepEqual(declaredHosts("en.wikipedia.org, wikidata.org"), ["en.wikipedia.org", "wikidata.org"]);
  // These two are real registry values and must contribute NO host rules.
  assert.deepEqual(declaredHosts("~60 publisher feeds"), []);
  assert.deepEqual(declaredHosts("various governing bodies"), []);
  assert.deepEqual(declaredHosts(null), []);
  assert.deepEqual(declaredHosts("https://api.sportradar.com/v1/x"), ["api.sportradar.com"]);
});

// ── WHOLE-REGISTRY INVARIANTS ──────────────────────────────────────────────

test("every disabled-only host is actually blocked", () => {
  // Derived from the registry rather than hardcoded, so a source added later is
  // covered without anyone remembering to extend this test.
  const byHost = new Map<string, string[]>();
  for (const s of INGESTION_SOURCES) {
    for (const h of declaredHosts(s.host)) {
      byHost.set(h, [...(byHost.get(h) ?? []), s.id]);
    }
  }
  let checked = 0;
  for (const [host, ids] of byHost) {
    if (ids.some((id) => effectiveEnabled(id, env()))) continue;
    checked++;
    const d = gateDecision(`https://${host}/anything`, env());
    assert.equal(d.allowed, false, `${host} (${ids.join(",")}) should be blocked`);
  }
  assert.ok(checked > 0, "the registry must contain at least one fully-disabled host");
});

test("no source claims a host it does not own via prose matching", () => {
  // Guards the parser: if declaredHosts ever started returning junk tokens, a
  // disabled prose entry could block an unrelated live host.
  for (const s of INGESTION_SOURCES) {
    for (const h of declaredHosts(s.host)) {
      assert.match(h, /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/, `${s.id} produced a non-host "${h}"`);
    }
  }
});
