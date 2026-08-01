// ESPN provider tests over REAL captured scoreboard JSON.
//
//   npm run test:espn

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { toNormalizedEvent, normalizeWeightClass, ESPN_SOURCE } from "../map";
import { ESPN_LEAGUES, DEFAULT_LEAGUE_KEYS, leagueFor } from "../leagues";
import { SOURCE_POLICIES, supportsLiveResultUpdates } from "../../source-policy";
import type { EspnScoreboard } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string): EspnScoreboard =>
  JSON.parse(readFileSync(join(here, "fixtures", n), "utf8")) as EspnScoreboard;

const UFC = leagueFor("ufc")!;
const PFL = leagueFor("pfl")!;

describe("ESPN → NormalizedEvent (UFC 297)", () => {
  const raw = fixture("ufc-297.json").events![0];
  const ev = toNormalizedEvent(raw, UFC, new Date("2025-01-01"))!;

  it("maps the card", () => {
    assert.ok(ev);
    assert.equal(ev.name, "UFC 297: Strickland vs. Du Plessis");
    assert.equal(ev.promotion, "UFC");
    assert.equal(ev.sport, "MMA");
    assert.equal(ev.status, "COMPLETED");
    assert.equal(ev.date.slice(0, 10), "2024-01-20");
  });

  it("takes the venue off the bouts, where ESPN actually puts it", () => {
    assert.equal(ev.venue, "Scotiabank Arena");
    assert.equal(ev.city, "Toronto");
    assert.equal(ev.country, "Canada");
  });

  it("puts the MAIN EVENT first", () => {
    // ESPN lists a card prelims-first. Unreversed, every card is upside down and
    // the opener is presented as the headliner.
    const main = ev.fights![0];
    assert.ok(main.mainEvent);
    assert.deepEqual(
      [main.redName, main.blueName].sort(),
      ["Dricus Du Plessis", "Sean Strickland"],
    );
    assert.ok(!ev.fights!.slice(1).some((f) => f.mainEvent), "only one main event");
  });

  it("records the winner against a corner that exists on the bout", () => {
    const main = ev.fights![0];
    assert.equal(main.result, "WIN");
    assert.equal(main.winnerExternalId, main.redExternalId === main.winnerExternalId ? main.redExternalId : main.blueExternalId);
    assert.ok([main.redExternalId, main.blueExternalId].includes(main.winnerExternalId));
    for (const f of ev.fights!) {
      if (f.result !== "WIN") continue;
      assert.ok([f.redExternalId, f.blueExternalId].includes(f.winnerExternalId));
    }
  });

  it("finds the athlete id where ESPN actually puts it", () => {
    // In MMA the competitor IS the athlete, so the id is on the competitor and
    // `athlete.id` is usually absent. Reading athlete.id alone looks more correct
    // and produced no ids at all — which silently turned a fully-decided card
    // into twelve pending bouts, because a WIN needs a winner id.
    for (const f of ev.fights!) {
      assert.match(f.redExternalId ?? "", /^espn:\d+$/);
      assert.match(f.blueExternalId ?? "", /^espn:\d+$/);
    }
  });

  it("carries the whole card with rounds and divisions", () => {
    assert.equal(ev.fights!.length, 12);
    const main = ev.fights![0];
    assert.equal(main.scheduledRounds, 5);
    assert.equal(main.weightClass, "Middleweight");
    assert.ok(ev.fights!.every((f) => (f.scheduledRounds ?? 0) >= 3));
  });

  it("never invents a method or a finish time", () => {
    // The scoreboard carries neither, and `displayClock` does not say whether it
    // counts up or down — writing it into timeEnded would be a coin flip
    // presented as a fact.
    for (const f of ev.fights!) {
      assert.equal(f.method, undefined);
      assert.equal((f as { timeEnded?: string }).timeEnded, undefined);
    }
  });

  it("tags provenance as espn", () => {
    assert.equal(ev._meta.source, ESPN_SOURCE);
    assert.match(ev.externalId, /^espn:ufc:\d+$/);
  });
});

describe("ESPN → NormalizedEvent (PFL season)", () => {
  const board = fixture("pfl-2024.json");

  it("maps every card in a year with one request", () => {
    const evs = (board.events ?? [])
      .map((e) => toNormalizedEvent(e, PFL, new Date("2025-01-01")))
      .filter((e) => e !== null);
    assert.ok(evs.length >= 8, `expected a season of cards, got ${evs.length}`);
    for (const ev of evs) {
      assert.equal(ev!.promotion, "PFL");
      assert.ok((ev!.fights?.length ?? 0) > 0, `${ev!.name} has no bouts`);
    }
  });

  it("leaves a bout undecided when ESPN marks no winner", () => {
    // A final bout with no winner flag is a draw or a no-contest and the
    // scoreboard does not say which. Claiming a WIN nobody won is worse than
    // leaving it pending.
    const evs = (board.events ?? []).map((e) => toNormalizedEvent(e, PFL)).filter(Boolean);
    for (const ev of evs) {
      for (const f of ev!.fights ?? []) {
        if (f.result === "WIN") assert.ok(f.winnerExternalId, "WIN without a winner");
        else assert.equal(f.winnerExternalId, undefined);
      }
    }
  });
});

describe("weight class normalisation", () => {
  it("expands ESPN's women's abbreviation", () => {
    assert.equal(normalizeWeightClass("W Bantamweight"), "Women's Bantamweight");
    assert.equal(normalizeWeightClass("W Strawweight"), "Women's Strawweight");
  });
  it("leaves everything else alone", () => {
    assert.equal(normalizeWeightClass("Middleweight"), "Middleweight");
    assert.equal(normalizeWeightClass(undefined), undefined);
    assert.equal(normalizeWeightClass("  "), undefined);
  });
});

describe("league config", () => {
  it("files ONE under ESPN's legacy slug", () => {
    // `one` is an HTTP 400; ESPN still calls it One Fighting Championship.
    const one = leagueFor("one");
    assert.equal(one?.slug, "ofc");
    assert.equal(one?.promotion, "ONE Championship");
  });

  it("has a unique key and slug per league", () => {
    assert.equal(new Set(ESPN_LEAGUES.map((l) => l.key)).size, ESPN_LEAGUES.length);
    assert.equal(new Set(ESPN_LEAGUES.map((l) => l.slug)).size, ESPN_LEAGUES.length);
  });

  it("every default key resolves", () => {
    for (const k of DEFAULT_LEAGUE_KEYS) assert.ok(leagueFor(k), `unknown default league: ${k}`);
  });
});

describe("source policy", () => {
  it("treats espn as revisitable — its scoreboard settles after the card", () => {
    assert.equal(supportsLiveResultUpdates("espn"), true);
  });

  it("treats the tournament import as one-shot", () => {
    assert.equal(supportsLiveResultUpdates("wikipedia-tournament"), false);
  });

  it("fails OPEN for an unregistered source", () => {
    // Treating a live source as static loses a real result, silently and forever.
    // Treating a static one as live wastes visible requests. Not symmetric.
    assert.equal(supportsLiveResultUpdates("some-future-provider"), true);
  });

  it("declares each source once", () => {
    const keys = SOURCE_POLICIES.map((p) => p.source);
    assert.equal(new Set(keys).size, keys.length);
  });
});
