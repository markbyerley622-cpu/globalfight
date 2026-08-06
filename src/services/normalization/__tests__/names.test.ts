// Name normalisation — the bottom of the identity stack.
//
// Every rung of the resolver compares keys produced here, so a bug in this file
// is a duplicate fighter in production. It had one.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeName, nameKey, looseKey } from "../names";

const same = (a: string, b: string) => nameKey(a) === nameKey(b);

describe("the dot bug", () => {
  it("treats a dot BETWEEN words as a separator — REGRESSION", () => {
    // Dots and apostrophes were deleted together. "Numsurin Chor.Ketwina"
    // became "chorketwina" — ONE token where the registry's "Chor Ketwina" has
    // two — so they never compared equal at any rung. Two fighters were created
    // and the same bout was written twice during the ONE backfill.
    assert.ok(same("Numsurin Chor Ketwina", "Numsurin Chor.Ketwina"));
    assert.equal(nameKey("Numsurin Chor.Ketwina"), "numsurin chor ketwina");
  });

  it("handles the Thai ring names that made this systemic", () => {
    // Not one unlucky row: Muay Thai names are written with these dots
    // constantly, and ONE is a Muay Thai promotion.
    assert.ok(same("Suablack Tor Pran49", "Suablack Tor.Pran49"));
    assert.ok(same("Petchtanong Sor.Sommai", "Petchtanong Sor Sommai"));
    assert.ok(same("Kongthoranee Sor Sommai", "Kongthoranee Sor.Sommai"));
  });

  it("still folds INITIALS, which have a dot after one letter", () => {
    // The fix's two-character floor. Splitting on an initial's dot would give
    // "a j smith" against a registry holding "aj smith" — trading one class of
    // duplicate for another.
    assert.ok(same("A.J. Smith", "AJ Smith"));
    assert.ok(same("R.J. Barrett", "RJ Barrett"));
  });

  it("still deletes a trailing dot", () => {
    assert.ok(same("José Aldo Jr.", "Jose Aldo"));
  });
});

describe("normalizeName", () => {
  it("strips diacritics", () => {
    assert.equal(normalizeName("José Aldo"), "jose aldo");
    assert.equal(normalizeName("Ilía Topuria"), "ilia topuria");
  });

  it("folds an apostrophe away entirely", () => {
    // Deliberately NOT a separator: sources write both "O'Malley" and
    // "OMalley", and they are the same name.
    assert.equal(normalizeName("Conor O'Malley"), "conor omalley");
    assert.equal(normalizeName("Conor O’Malley"), "conor omalley");
  });

  it("turns other punctuation into a space", () => {
    assert.equal(normalizeName("Jean-Claude Van Damme"), "jean-claude van damme");
    assert.equal(normalizeName("Smith, John"), "smith john");
  });

  it("collapses whitespace and trims", () => {
    assert.equal(normalizeName("  Jon   Jones  "), "jon jones");
  });
});

describe("nameKey", () => {
  it("removes generational suffixes", () => {
    assert.equal(nameKey("Bruno Silva Jr"), "bruno silva");
    assert.equal(nameKey("Marcus Silva III"), "marcus silva");
  });

  it("keeps everything else", () => {
    assert.equal(nameKey("Israel Mobolaji Adesanya"), "israel mobolaji adesanya");
  });

  it("never returns leading or trailing space", () => {
    for (const raw of ["  A.B  ", "Jr.", " . ", "—"]) {
      const k = nameKey(raw);
      assert.equal(k, k.trim(), `"${raw}" produced padded key ${JSON.stringify(k)}`);
    }
  });
});

describe("looseKey", () => {
  it("drops middle names", () => {
    assert.equal(looseKey("Israel Mobolaji Adesanya"), "israel adesanya");
  });

  it("passes a single token through", () => {
    assert.equal(looseKey("Yodkhunpon"), "yodkhunpon");
  });

  it("agrees with nameKey on a two-token name", () => {
    assert.equal(looseKey("Jon Jones"), nameKey("Jon Jones"));
  });
});

describe("what must NOT collapse", () => {
  it("keeps different people apart", () => {
    assert.ok(!same("Jon Jones", "Jon Smith"));
    assert.ok(!same("Alex Pereira", "Alex Perez"));
    // A gym suffix is not noise to be stripped — "Yodkhunpon" and "Yodkhunpon
    // Sitmonchai" may be the same person, and that is a REVIEW question, not a
    // normalisation one. Folding them here would merge on a guess.
    assert.ok(!same("Yodkhunpon", "Yodkhunpon Sitmonchai"));
  });

  it("is idempotent", () => {
    for (const raw of ["Numsurin Chor.Ketwina", "A.J. Smith", "José Aldo Jr."]) {
      assert.equal(nameKey(nameKey(raw)), nameKey(raw), raw);
    }
  });
});
