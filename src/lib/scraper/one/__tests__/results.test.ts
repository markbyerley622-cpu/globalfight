// ONE Championship live-results parser.
//
// Every assertion below runs against a REAL captured page
// (__fixtures__/fight-night-45.html), not against markup anyone imagined.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseOneResults, validateOneResults, splitDivision, splitNickname,
  athleteSlug, parseOutcome,
} from "../results";

const FIXTURE = readFileSync(join(process.cwd(), "src/lib/scraper/one/__fixtures__/fight-night-45.html"), "utf8");

describe("the real card", () => {
  const bouts = parseOneResults(FIXTURE);

  it("finds every bout on the card", () => {
    // ONE Fight Night 45 had nine bouts. The count is asserted rather than
    // "more than zero": a parser that finds SOME bouts is the failure mode that
    // ships, because the event looks populated.
    assert.equal(bouts.length, 9);
  });

  it("reads the main event exactly as published", () => {
    assert.deepEqual(
      {
        red: bouts[0].redName, blue: bouts[0].blueName,
        method: bouts[0].method, ruleset: bouts[0].ruleset, weightClass: bouts[0].weightClass,
      },
      {
        red: "Luke Lessei", blue: "Mohamed Younes Rabah",
        method: "unanimous decision", ruleset: "MUAY_THAI", weightClass: "Featherweight",
      },
    );
  });

  it("captures round and time on a finish", () => {
    const ko = bouts.find((b) => b.method === "knockout");
    assert.ok(ko, "the card had a knockout");
    assert.equal(ko!.redName, "Suablack Tor Pran49");
    assert.equal(ko!.round, 2);
    assert.equal(ko!.time, "1:39");
  });

  it("carries an athlete slug for BOTH corners of every bout", () => {
    // The reason this source is worth having. A ONE bout resolves its corners by
    // EXTERNAL ID rather than by name, permanently, from the first import —
    // which is the identity resolver's strongest rung.
    for (const b of bouts) {
      assert.ok(b.redExternalId, `${b.redName} has no slug`);
      assert.ok(b.blueExternalId, `${b.blueName} has no slug`);
    }
    assert.equal(bouts[0].redExternalId, "luke-lessei");
    assert.equal(bouts[0].blueExternalId, "mohamed-younes-rabah");
  });

  it("reads the ruleset PER BOUT, not per event", () => {
    // ONE runs mixed cards. Fight Night 45 was five MMA bouts and four Muay Thai,
    // so an event-level sport would be wrong for whichever half it was not.
    const rulesets = new Set(bouts.map((b) => b.ruleset));
    assert.deepEqual([...rulesets].sort(), ["MMA", "MUAY_THAI"]);
  });

  it("strips the ruleset OUT of the division name", () => {
    // WeightClass resolves by (sport, name). Leaving "Flyweight Muay Thai" in the
    // name would create a separate division row per discipline, splitting one
    // flyweight ladder into several.
    for (const b of bouts) {
      assert.ok(!/muay|mma|kickbox/i.test(b.weightClass ?? ""), `${b.weightClass} still carries a ruleset`);
    }
    assert.ok(bouts.some((b) => b.weightClass === "Flyweight" && b.ruleset === "MMA"));
    assert.ok(bouts.some((b) => b.weightClass === "Flyweight" && b.ruleset === "MUAY_THAI"));
  });

  it("does not let the LAST bout absorb the page chrome — REGRESSION", () => {
    // The first version stopped the walk only at the next <h5>. The final bout
    // on every card has none, so its method came out as "unanimous decision
    // Featured Liu Mengyang … Buy Tickets STAY IN THE KNOW". Every bout but one
    // looked perfect, which is exactly how this kind of defect ships.
    const last = bouts[bouts.length - 1];
    assert.equal(last.method, "unanimous decision");
    for (const b of bouts) {
      assert.ok((b.method ?? "").length <= 60, `method too long: ${b.method}`);
    }
  });

  it("numbers bouts in published order, main event first", () => {
    assert.deepEqual(bouts.map((b) => b.order), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("records every bout as decided", () => {
    assert.ok(bouts.every((b) => b.result === "WIN"));
  });

  it("passes its own validator", () => {
    assert.doesNotThrow(() => validateOneResults(bouts));
  });
});

describe("nicknames", () => {
  it("strips a nickname from either position", () => {
    // Both forms appear on the SAME card.
    assert.deepEqual(splitNickname("Luke “The Chef” Lessei"), { name: "Luke Lessei", nickname: "The Chef" });
    assert.deepEqual(splitNickname("“The Eagle” Mohamed Younes Rabah"), {
      name: "Mohamed Younes Rabah", nickname: "The Eagle",
    });
  });

  it("keeps a name that IS a nickname", () => {
    // "Black Panther" competes under exactly that. Returning an empty name would
    // drop the fighter entirely.
    assert.deepEqual(splitNickname("Black Panther"), { name: "Black Panther", nickname: null });
  });

  it("accepts straight quotes too", () => {
    assert.deepEqual(splitNickname('Jane "Ace" Doe'), { name: "Jane Doe", nickname: "Ace" });
  });
});

describe("divisions", () => {
  it("splits division from ruleset", () => {
    assert.deepEqual(splitDivision("Featherweight Muay Thai"), { weightClass: "Featherweight", ruleset: "MUAY_THAI" });
    assert.deepEqual(splitDivision("Flyweight MMA"), { weightClass: "Flyweight", ruleset: "MMA" });
    assert.deepEqual(splitDivision("Lightweight Kickboxing"), { weightClass: "Lightweight", ruleset: "KICKBOXING" });
    assert.deepEqual(splitDivision("Openweight Submission Grappling"), {
      weightClass: "Openweight", ruleset: "SUBMISSION_GRAPPLING",
    });
  });

  it("keeps an unrecognised heading rather than dropping it", () => {
    assert.deepEqual(splitDivision("Catchweight"), { weightClass: "Catchweight", ruleset: null });
  });
});

describe("outcomes", () => {
  it("reads a written-out round number", () => {
    assert.deepEqual(parseOutcome("via knockout at 1:39 of round two"), {
      method: "knockout", round: 2, time: "1:39", result: "WIN",
    });
  });

  it("reads a numeric round", () => {
    assert.deepEqual(parseOutcome("via submission at 3:02 of round 3"), {
      method: "submission", round: 3, time: "3:02", result: "WIN",
    });
  });

  it("handles a decision with no round or time", () => {
    assert.deepEqual(parseOutcome("via split decision"), {
      method: "split decision", round: null, time: null, result: "WIN",
    });
  });

  it("recognises draws and no contests", () => {
    assert.equal(parseOutcome("the bout was ruled a draw").result, "DRAW");
    assert.equal(parseOutcome("declared a No Contest").result, "NO_CONTEST");
  });

  it("keeps the source's own words rather than mapping to an enum", () => {
    // Normalising a method is the ingest layer's decision. Keeping the published
    // wording means a method we have not seen before survives the parse instead
    // of becoming "OTHER".
    assert.equal(parseOutcome("via doctor stoppage at 0:44 of round one").method, "doctor stoppage");
  });
});

describe("athlete slugs", () => {
  it("extracts the slug from a profile URL", () => {
    assert.equal(athleteSlug("https://www.onefc.com/athletes/luke-lessei/"), "luke-lessei");
    assert.equal(athleteSlug("/athletes/Jihin-Radzuan/?x=1"), "jihin-radzuan");
  });

  it("returns null for anything else", () => {
    assert.equal(athleteSlug("https://www.onefc.com/news/whatever/"), null);
    assert.equal(athleteSlug(undefined), null);
  });
});

describe("fail closed", () => {
  it("refuses a card that parsed too few bouts", () => {
    // A redesign that leaves this returning two bouts must publish NOTHING. An
    // event whose card is silently 20% complete is indistinguishable from a real
    // short card and far harder to notice than an empty one.
    assert.throws(() => validateOneResults(parseOneResults("<h5>Flyweight MMA</h5>")), /refusing to publish a partial card/);
  });

  it("refuses a card where no corner was linked", () => {
    const nameOnly = Array.from({ length: 6 }, (_, i) => ({
      redName: `A${i}`, blueName: `B${i}`, redExternalId: null, blueExternalId: null,
      redNickname: null, blueNickname: null, weightClass: "Flyweight", ruleset: "MMA",
      method: "decision", round: null, time: null, result: "WIN" as const, order: i,
    }));
    // Names alone are the identity signal this source exists to avoid relying on.
    assert.throws(() => validateOneResults(nameOnly), /no athlete profile links/);
  });

  it("returns an empty list for an unrelated page, and never throws", () => {
    assert.deepEqual(parseOneResults("<html><body><p>Nothing here</p></body></html>"), []);
  });
});
