// Provider reconciliation. Pure — no database.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconcile, reconcileList, TIER_ORDER, MAX_AGE_DAYS, type Observation, type Tier } from "../reconcile";

const NOW = new Date("2026-08-06T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
const obs = (over: Partial<Observation<string>> = {}): Observation<string> => ({
  id: `o${seq++}`,
  provider: "ufc",
  tier: "OFFICIAL",
  effectiveDate: daysAgo(1),
  retrievedAt: daysAgo(1),
  sourceUrl: "https://ufc.com/rankings",
  value: "fighter-a",
  ...over,
});

describe("tier precedence", () => {
  it("orders official above encyclopaedic above aggregator above internal", () => {
    assert.ok(TIER_ORDER.OFFICIAL < TIER_ORDER.ENCYCLOPAEDIC);
    assert.ok(TIER_ORDER.ENCYCLOPAEDIC < TIER_ORDER.AGGREGATOR);
    assert.ok(TIER_ORDER.AGGREGATOR < TIER_ORDER.INTERNAL);
  });

  it("NEVER lets Wikipedia overwrite an official ranking", () => {
    // The rule the whole architecture exists to enforce.
    const decision = reconcile(
      [
        obs({ provider: "wikidata", tier: "ENCYCLOPAEDIC", value: "fighter-b", effectiveDate: daysAgo(0) }),
        obs({ provider: "ufc", tier: "OFFICIAL", value: "fighter-a", effectiveDate: daysAgo(30) }),
      ],
      { now: NOW },
    );
    assert.equal(decision!.value, "fighter-a");
    assert.equal(decision!.provider, "ufc");
  });

  it("does not discard the loser — it records the disagreement", () => {
    // The old pipeline overwrote a single row, so the losing value never landed
    // and no conflict could be DETECTED. Contested is that detection.
    const decision = reconcile(
      [
        obs({ provider: "ufc", tier: "OFFICIAL", value: "fighter-a" }),
        obs({ provider: "wikidata", tier: "ENCYCLOPAEDIC", value: "fighter-b" }),
      ],
      { now: NOW },
    );
    assert.equal(decision!.contested, true);
    assert.match(decision!.reason, /ufc \(OFFICIAL\) over wikidata/);
  });

  it("is not contested when the tiers merely differ but agree", () => {
    const decision = reconcile(
      [
        obs({ provider: "ufc", tier: "OFFICIAL", value: "fighter-a" }),
        obs({ provider: "wikidata", tier: "ENCYCLOPAEDIC", value: "fighter-a" }),
      ],
      { now: NOW },
    );
    assert.equal(decision!.contested, false);
    assert.equal(decision!.agreementCount, 2);
  });
});

describe("recency", () => {
  it("prefers the newer publication WITHIN a tier", () => {
    const decision = reconcile(
      [
        obs({ provider: "a", value: "old", effectiveDate: daysAgo(20) }),
        obs({ provider: "b", value: "new", effectiveDate: daysAgo(1) }),
      ],
      { now: NOW },
    );
    assert.equal(decision!.value, "new");
  });

  it("does NOT let recency cross a tier boundary", () => {
    // A three-month-old official ranking still outranks a Wikipedia edit from
    // this morning: the organisation is authoritative about its own list, and
    // Wikipedia being fresher does not make it right.
    const decision = reconcile(
      [
        obs({ provider: "wikidata", tier: "ENCYCLOPAEDIC", value: "fresh", effectiveDate: daysAgo(0) }),
        obs({ provider: "ufc", tier: "OFFICIAL", value: "stale", effectiveDate: daysAgo(90) }),
      ],
      { now: NOW },
    );
    assert.equal(decision!.value, "stale");
  });

  it("refuses evidence older than the ceiling, at every tier", () => {
    // A provider that went dark should stop deciding what we publish. Without
    // this the last thing a dead source said is served forever at full
    // confidence.
    const decision = reconcile([obs({ effectiveDate: daysAgo(MAX_AGE_DAYS + 1) })], { now: NOW });
    assert.equal(decision, null);
  });

  it("returns null rather than inventing something when nothing is usable", () => {
    assert.equal(reconcile([], { now: NOW }), null);
  });
});

describe("agreement", () => {
  it("counts DISTINCT providers, not observations", () => {
    // One source publishing the same list twice is not two sources agreeing —
    // counting it that way would let a single provider manufacture consensus.
    const decision = reconcile(
      [
        obs({ provider: "ufc", value: "x", effectiveDate: daysAgo(1) }),
        obs({ provider: "ufc", value: "x", effectiveDate: daysAgo(2) }),
      ],
      { now: NOW },
    );
    assert.equal(decision!.agreementCount, 1);
  });

  it("carries the observation ids behind the decision", () => {
    const a = obs({ provider: "ufc", value: "x" });
    const b = obs({ provider: "wikidata", tier: "ENCYCLOPAEDIC", value: "x" });
    const c = obs({ provider: "other", tier: "AGGREGATOR", value: "y" });
    const decision = reconcile([a, b, c], { now: NOW });
    // Only the AGREEING observations — the audit trail for what was published,
    // not for everything that was considered.
    assert.deepEqual(decision!.observationIds.sort(), [a.id, b.id].sort());
  });
});

describe("determinism", () => {
  it("gives the same answer whatever order the evidence arrives in", () => {
    // The old pipeline's outcome depended on which connector ran first whenever
    // trust tiers tied. This is that failure mode, asserted away.
    const rows = [
      obs({ provider: "a", tier: "OFFICIAL", value: "x", effectiveDate: daysAgo(3) }),
      obs({ provider: "b", tier: "OFFICIAL", value: "y", effectiveDate: daysAgo(3) }),
      obs({ provider: "c", tier: "ENCYCLOPAEDIC", value: "z", effectiveDate: daysAgo(1) }),
    ];
    const forwards = reconcile(rows, { now: NOW });
    const backwards = reconcile([...rows].reverse(), { now: NOW });
    assert.equal(forwards!.value, backwards!.value);
    assert.equal(forwards!.provider, backwards!.provider);
  });
});

describe("custom equality", () => {
  it("uses the caller's comparison so structured claims can agree", () => {
    // Champion claims are objects. Comparing them by reference would make every
    // source disagree with every other and mark every belt contested.
    type Claim = { fighterId: string | null; status: string };
    const claim = (fighterId: string): Observation<Claim> => ({
      id: `c${seq++}`, provider: `p${seq}`, tier: "OFFICIAL",
      effectiveDate: daysAgo(1), retrievedAt: daysAgo(1), sourceUrl: null,
      value: { fighterId, status: "CHAMPION" },
    });
    const decision = reconcile([claim("f1"), claim("f1")], {
      now: NOW,
      equals: (a, b) =>
        (a as Claim).fighterId === (b as Claim).fighterId && (a as Claim).status === (b as Claim).status,
    });
    assert.equal(decision!.contested, false);
    assert.equal(decision!.agreementCount, 2);
  });
});

describe("list reconciliation", () => {
  const entry = (provider: string, tier: Tier, key: string, when: Date): Observation<{ key: string }> => ({
    id: `l${seq++}`, provider, tier, effectiveDate: when, retrievedAt: when,
    sourceUrl: null, value: { key },
  });

  it("takes ONE provider's board whole rather than mixing positions", () => {
    // Two providers publishing a division publish an ORDER. Merging them
    // position by position produces a board neither source endorsed, and one
    // that can contain the same fighter twice.
    const day = daysAgo(1);
    const outcome = reconcileList(
      [
        entry("ufc", "OFFICIAL", "a", day),
        entry("ufc", "OFFICIAL", "b", day),
        entry("wiki", "ENCYCLOPAEDIC", "c", day),
      ],
      { now: NOW },
    );
    assert.equal(outcome!.decision.provider, "ufc");
    assert.deepEqual(outcome!.winner.map((o) => o.value.key).sort(), ["a", "b"]);
  });

  it("flags a list as contested when another provider ranks someone else", () => {
    const day = daysAgo(1);
    const outcome = reconcileList(
      [entry("ufc", "OFFICIAL", "a", day), entry("wiki", "ENCYCLOPAEDIC", "z", day)],
      { now: NOW },
    );
    assert.equal(outcome!.decision.contested, true);
  });

  it("is not contested when a lower tier lists the same people", () => {
    const day = daysAgo(1);
    const outcome = reconcileList(
      [entry("ufc", "OFFICIAL", "a", day), entry("wiki", "ENCYCLOPAEDIC", "a", day)],
      { now: NOW },
    );
    assert.equal(outcome!.decision.contested, false);
    assert.equal(outcome!.decision.agreementCount, 2);
  });

  it("takes only the winning provider's LATEST publication", () => {
    // A provider's older board must not bleed into its newer one — that is how a
    // fighter who dropped out stays on the list forever.
    const outcome = reconcileList(
      [
        entry("ufc", "OFFICIAL", "old", daysAgo(30)),
        entry("ufc", "OFFICIAL", "new", daysAgo(1)),
      ],
      { now: NOW },
    );
    assert.deepEqual(outcome!.winner.map((o) => o.value.key), ["new"]);
  });

  it("returns null when every board is too old", () => {
    const outcome = reconcileList([entry("ufc", "OFFICIAL", "a", daysAgo(MAX_AGE_DAYS + 5))], { now: NOW });
    assert.equal(outcome, null);
  });
});
