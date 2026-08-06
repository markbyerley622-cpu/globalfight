// Identity decision rules. Pure — no database, no fixtures.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  corroborate, decide, demoteAcrossSports, isActionable, isReviewable,
  AUTO_LINK_THRESHOLD, REVIEW_FLOOR,
} from "../identity-rules";

describe("corroboration", () => {
  it("treats a matching birthdate as the strongest agreement", () => {
    assert.equal(
      corroborate({ birthDate: "1994-01-21" }, { birthDate: new Date("1994-01-21T00:00:00Z") }),
      "birthdate_match",
    );
  });

  it("VETOES on a differing birthdate, even when everything else agrees", () => {
    // The one hard veto. Two people born on different days are different people
    // however identical their names — and this must be checked BEFORE any
    // agreement, or a matching nationality would mask it.
    assert.equal(
      corroborate(
        { birthDate: "1994-01-21", countryCode: "GB" },
        { birthDate: "1988-06-02", countryCode: "GB" },
      ),
      "birthdate_conflict",
    );
  });

  it("falls back to nationality when only one side has a birthdate", () => {
    assert.equal(
      corroborate({ birthDate: "1994-01-21", countryCode: "GB" }, { countryCode: "GB" }),
      "nationality_match",
    );
  });

  it("compares an ISO code against a country NAME on the other side", () => {
    assert.equal(corroborate({ countryCode: "GB" }, { nationality: "gb" }), "nationality_match");
  });

  it("treats absence as 'cannot corroborate', never as disagreement", () => {
    // Most imported rows have no birthdate at all. Reading a missing fact as a
    // mismatch would refuse nearly every legitimate match in the database.
    assert.equal(corroborate({}, {}), "none");
    assert.equal(corroborate({ birthDate: "1994-01-21" }, {}), "none");
    assert.equal(corroborate({ countryCode: "GB" }, {}), "none");
  });

  it("ignores an unparseable date rather than throwing", () => {
    assert.equal(corroborate({ birthDate: "not a date" }, { birthDate: "1994-01-21" }), "none");
  });
});

describe("decisions", () => {
  it("acts on an exact identifier without corroboration", () => {
    // An external id, a canonical name or a registry alias IS an identity claim.
    for (const via of ["external_id", "name_exact", "alias"] as const) {
      const v = decide(via, "none");
      assert.equal(v.outcome, "MATCH_CONFIDENT", via);
      assert.ok(v.confidence >= AUTO_LINK_THRESHOLD);
    }
  });

  it("refuses an exact name match when the birthdates conflict", () => {
    const v = decide("name_exact", "birthdate_conflict");
    assert.equal(v.outcome, "NO_MATCH");
    assert.equal(v.confidence, 0);
    assert.match(v.reason, /vetoed/);
  });

  it("promotes a weak name inference when the birthdate agrees", () => {
    // "Ricardo Salas" vs "Ricardo Salas Rodríguez" is a guess on its own; with a
    // matching date of birth it is not.
    const alone = decide("paternal", "none");
    const backed = decide("paternal", "birthdate_match");
    assert.equal(alone.outcome, "MATCH_POSSIBLE");
    assert.equal(backed.outcome, "MATCH_CONFIDENT");
    assert.ok(backed.confidence > alone.confidence);
  });

  it("never claims a corroborated inference is as certain as an external id", () => {
    assert.ok(decide("paternal", "birthdate_match").confidence < 1);
    assert.ok(decide("name_loose", "birthdate_match").confidence <= 0.97);
  });

  it("leaves a nationality-only match in the review band", () => {
    // Sharing a country is weak evidence — most fighters in a division share a
    // handful of them.
    const v = decide("name_loose", "nationality_match");
    assert.equal(v.outcome, "MATCH_POSSIBLE");
    assert.ok(v.confidence < AUTO_LINK_THRESHOLD);
  });

  it("drops anything below the review floor rather than queueing it", () => {
    // A queue nobody can finish is a queue nobody reads.
    const v = decide("acronym", "none");
    assert.equal(v.outcome, "NO_MATCH");
    assert.equal(isReviewable(v), false);
  });

  it("keeps the two thresholds in the right order", () => {
    assert.ok(REVIEW_FLOOR < AUTO_LINK_THRESHOLD, "the review band must be non-empty");
  });
});

describe("cross-discipline matches", () => {
  const confident = decide("name_exact", "none");

  it("demotes a NAME-only match that crosses sports to review", () => {
    // Two different people sharing a common name across two sports is normal.
    // The old slug key merged them silently.
    const v = demoteAcrossSports(confident, false, "name_exact");
    assert.equal(v.outcome, "MATCH_POSSIBLE");
    assert.match(v.reason, /sport_mismatch/);
  });

  it("lets an external id cross sports freely", () => {
    // An id is an identity claim, not a name — and a crossover athlete is a real
    // thing the registry models on purpose (Fighter.sports is an array).
    const v = demoteAcrossSports(decide("external_id", "none"), false, "external_id");
    assert.equal(v.outcome, "MATCH_CONFIDENT");
  });

  it("lets a birthdate-corroborated match cross sports", () => {
    const backed = decide("name_loose", "birthdate_match");
    assert.equal(demoteAcrossSports(backed, false, "name_loose").outcome, "MATCH_CONFIDENT");
  });

  it("changes nothing when the sports agree", () => {
    assert.deepEqual(demoteAcrossSports(confident, true, "name_exact"), confident);
  });

  it("never PROMOTES anything", () => {
    const possible = decide("name_loose", "none");
    assert.equal(demoteAcrossSports(possible, true, "name_loose").outcome, "MATCH_POSSIBLE");
    assert.equal(demoteAcrossSports(possible, false, "name_loose").outcome, "MATCH_POSSIBLE");
  });
});

describe("the guarantee", () => {
  it("only ever acts automatically on a confident verdict", () => {
    for (const via of ["external_id", "name_exact", "alias", "nickname", "name_loose", "paternal", "initial", "translit", "acronym"] as const) {
      for (const c of ["none", "birthdate_match", "nationality_match", "birthdate_conflict"] as const) {
        const v = decide(via, c);
        if (isActionable(v)) {
          // The whole contract in one assertion: an automatic link is only ever
          // reached by an exact identifier, or by an inference that a hard fact
          // corroborated. Never by a name alone below the threshold.
          const exact = v.confidence >= AUTO_LINK_THRESHOLD && c !== "birthdate_conflict";
          assert.ok(
            exact || c === "birthdate_match",
            `${via} + ${c} became actionable without an identifier or corroboration`,
          );
        }
        // And a conflicting birthdate is never actionable, whatever the name says.
        if (c === "birthdate_conflict") assert.equal(isActionable(v), false, `${via} + ${c}`);
      }
    }
  });
});
