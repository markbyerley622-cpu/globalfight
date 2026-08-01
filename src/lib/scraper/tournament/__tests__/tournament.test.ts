// Tournament provider tests, over REAL captured Wikipedia HTML (fixtures/).
//
// Fixtures rather than hand-written markup on purpose: every bug these parsers
// have had came from the difference between how a bracket looks and how it is
// actually marked up — rowspan spacers, headings wrapped in <div class="mw-heading">,
// the gym in a <small>. Synthetic HTML would have passed all of them.
//
//   npm run test:tournament

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { slugify } from "@/lib/utils";
import { parseBrackets } from "../bracket";
import { parseMedalFinals } from "../medals";
import { disambiguateName, pageMeta, parseWikiDate, subArticles } from "../wiki";
import { toNormalizedEvent } from "../map";
import type { TournamentCard } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, "fixtures", name), "utf8");

const WRESTLING = fixture("wrestling-2024-olympics-74kg.html");
const TAEKWONDO = fixture("taekwondo-2024-olympics-58kg.html");
const SAMBO = fixture("sambo-2023-worlds.html");
const ADCC = fixture("adcc-2022-worlds.html");
const HUB = fixture("wrestling-2023-worlds-hub.html");

const find = (bouts: ReturnType<typeof parseBrackets>, a: string, b: string) =>
  bouts.find(
    (x) =>
      (x.redName === a && x.blueName === b) || (x.redName === b && x.blueName === a),
  );
const winnerName = (bout: NonNullable<ReturnType<typeof find>>) =>
  bout.winner === "red" ? bout.redName : bout.winner === "blue" ? bout.blueName : null;

describe("bracket parsing — wrestling (Olympic freestyle 74 kg)", () => {
  const bouts = parseBrackets(WRESTLING);

  it("reconstructs the whole bracket", () => {
    // 22 on the captured page: R32 through the final, plus repechage and both
    // bronze matches. A collapse in the grid maths shows up here first.
    assert.ok(bouts.length >= 20, `expected a full bracket, got ${bouts.length}`);
  });

  it("reads the final, and agrees with the medal table", () => {
    const final = bouts.find((b) => b.round === "Final");
    assert.ok(final, "no final found");
    // Gold: Razambek Zhamalov. Silver: Daichi Takatani.
    assert.equal(winnerName(final), "Razambek Zhamalov");
    assert.ok([final.redName, final.blueName].includes("Daichi Takatani"));
    assert.equal(final.rank, 100);
  });

  it("pairs opponents within a round rather than across rounds", () => {
    const bout = find(bouts, "Kyle Dake", "Anthony Montero");
    assert.ok(bout, "Dake v Montero missing — column pairing is wrong");
    assert.equal(bout.round, "Round of 16");
    assert.equal(winnerName(bout), "Kyle Dake");
    assert.equal(bout.redScore, "10");
    assert.equal(bout.blueScore, "0");
  });

  it("keeps both bronze-medal matches", () => {
    const bronze = bouts.filter((b) => b.round === "Bronze medal match");
    assert.equal(bronze.length, 2);
    // Kyle Dake took a bronze; he must be shown WINNING his bronze match.
    const dake = bronze.find((b) => [b.redName, b.blueName].includes("Kyle Dake"));
    assert.ok(dake);
    assert.equal(winnerName(dake), "Kyle Dake");
  });

  it("never emits a bout against oneself, or with an empty corner", () => {
    for (const b of bouts) {
      assert.notEqual(b.redName, b.blueName);
      assert.ok(b.redName.length > 1 && b.blueName.length > 1);
      assert.match(b.redCountry ?? "", /^[A-Z]{2,4}$/);
    }
  });

  it("reads the date and venue off the infobox", () => {
    const meta = pageMeta(WRESTLING);
    assert.equal(meta.date?.slice(0, 10), "2024-08-09");
    assert.equal(meta.venue, "Grand Palais Éphémère");
  });
});

describe("bracket parsing — taekwondo (multi-round scores)", () => {
  const bouts = parseBrackets(TAEKWONDO);

  it("handles a per-round score run rather than a single number", () => {
    const final = bouts.find((b) => b.round === "Final");
    assert.ok(final);
    assert.equal(winnerName(final), "Park Tae-joon");
    // Best-of-three: the scores arrive as a run of cells, kept whole.
    assert.equal(final.redScore, "9 13");
  });

  it("labels the rounds it was given", () => {
    const rounds = new Set(bouts.map((b) => b.round));
    for (const expected of ["Final", "Semifinals", "Quarterfinals", "Round of 16"]) {
      assert.ok(rounds.has(expected), `missing round: ${expected}`);
    }
  });

  it("decides a bout on bold even when the loser led a round", () => {
    // Ravet won round 1 (5-8 across the run) and still lost the tie 2-1.
    const qf = find(bouts, "Cyrian Ravet", "Park Tae-joon");
    assert.ok(qf);
    assert.equal(winnerName(qf), "Park Tae-joon");
  });
});

describe("bracket parsing — judo (the two shapes one sport uses)", () => {
  const worlds = parseBrackets(fixture("judo-2024-worlds-60kg.html"));
  const olympics = parseBrackets(fixture("judo-2024-olympics-60kg.html"));

  it("reads a bracket that prints NO country code", () => {
    // The World Judo Championships bracket prints a bare "Jorre Verstraeten".
    // Requiring a trailing "(BEL)" returned zero bouts here, and the run
    // reported "no bracket found" for 36 of 48 judo division pages — our
    // over-strict pattern wearing a source-coverage costume.
    assert.ok(worlds.length >= 25, `expected a full bracket, got ${worlds.length}`);
    const bout = find(worlds, "Yang Yung-wei", "Jorre Verstraeten");
    assert.ok(bout, "country-less competitor cells were not recognised");
    assert.equal(bout.redCountry, null);
  });

  it("strips a seed number printed inside the name cell", () => {
    // The Olympic bracket prints "18 Andrea Carlino (ITA)". Left as-is the seed
    // becomes part of the name AND the slug, so the same athlete exists twice —
    // "1 Yang Yung-wei" from here and "Yang Yung-wei" from the worlds bracket.
    for (const b of olympics) {
      assert.doesNotMatch(b.redName, /^\d/, `seed left on: ${b.redName}`);
      assert.doesNotMatch(b.blueName, /^\d/, `seed left on: ${b.blueName}`);
    }
    assert.ok(find(olympics, "Yang Yung-wei", "Andrea Carlino"));
  });

  it("agrees with itself across both page shapes", () => {
    // Yang Yung-wei took silver at the 2024 worlds and competed at the Games;
    // both brackets must name him identically or he is two fighters.
    const inWorlds = worlds.some((b) => [b.redName, b.blueName].includes("Yang Yung-wei"));
    const inOlympics = olympics.some((b) => [b.redName, b.blueName].includes("Yang Yung-wei"));
    assert.ok(inWorlds && inOlympics);
  });

  it("does not read the medalists box as a bracket", () => {
    // That table is class-less like a bracket, and holds "Giorgi Sardalashvili
    // (1st title)" beside "Georgia" — a name-shaped cell next to a text cell.
    for (const b of [...worlds, ...olympics]) {
      assert.doesNotMatch(b.redName, /1st title|2nd title/i);
      assert.notEqual(b.blueName, "Georgia");
    }
  });
});

describe("medal tables — the sports with no bracket", () => {
  it("derives one final per sambo division, and separates combat sambo", () => {
    const finals = parseMedalFinals(SAMBO);
    assert.ok(finals.length >= 20, `expected ~21 finals, got ${finals.length}`);

    const combat = finals.filter((f) => f.combat);
    // Seven men's combat-sambo divisions sit under their own heading. Detecting
    // that heading is what routes them to COMBAT_SAMBO instead of SAMBO.
    assert.equal(combat.length, 7);
    assert.ok(combat.every((f) => f.round === "Final" && f.winner === "red"));

    const heavy = finals.find((f) => f.division === "+98 kg" && !f.combat);
    assert.ok(heavy);
    assert.equal(heavy.redName, "Artem Osipenko");
    assert.equal(heavy.blueName, "Ilie Natea");
    assert.equal(heavy.origin, "medal-final");
  });

  it("strips the gym and the flag out of an ADCC medal cell", () => {
    const finals = parseMedalFinals(ADCC);
    assert.equal(finals.length, 8);

    const heavy = finals.find((f) => f.division === "+99 kg");
    assert.ok(heavy);
    assert.equal(heavy.redName, "Gordon Ryan");
    assert.equal(heavy.blueName, "Nick Rodriguez");
    assert.equal(heavy.redCountry, "US");

    // "Craig Jones" is linked as "Craig Jones (BJJ)" and his team as "B-Team".
    // Both used to be discarded as gym links, taking the division with them.
    const j = finals.find((f) => f.division === "-99 kg");
    assert.ok(j, "-99 kg went missing");
    assert.equal(j.blueName, "Craig Jones");
    // A team name must never end up glued to the fighter's.
    for (const f of finals) {
      assert.doesNotMatch(f.redName, /Team|Jiu[- ]?Jitsu/i);
      assert.doesNotMatch(f.blueName, /Team|Jiu[- ]?Jitsu/i);
    }
  });

  it("ignores the medals-per-nation summary table", () => {
    // "Rank | Nation | Gold | Silver | Bronze | Total" holds counts, not people.
    const finals = parseMedalFinals(SAMBO);
    for (const f of finals) assert.doesNotMatch(f.redName, /^\d+$/);
  });
});

describe("hub pages", () => {
  it("lists the division sub-articles and drops the non-divisions", () => {
    const subs = subArticles(HUB, "2023 World Wrestling Championships");
    assert.equal(subs.length, 30);
    assert.ok(subs.some((s) => s.division === "Men's freestyle 74 kg"));
    assert.ok(!subs.some((s) => /qualification|medal table/i.test(s.division)));
  });

  it("reads the host city and country", () => {
    const meta = pageMeta(HUB);
    assert.equal(meta.city, "Belgrade");
    assert.equal(meta.country, "Serbia");
  });
});

describe("event naming — the +N kg slug collision", () => {
  // This is a regression test for real damage, not a hypothetical. persist.ts
  // upserts a new event on slugify(name); slugify collapses "+" to a hyphen, so
  // the heaviest division landed on the row of the one below it and merged the
  // two cards. Every bracket sport has a "+N kg" class above an "N kg" class.
  const heavier = "Taekwondo at the 2024 Summer Olympics – Men's +80 kg";
  const lighter = "Taekwondo at the 2024 Summer Olympics – Men's 80 kg";

  it("demonstrates the collision it exists to prevent", () => {
    assert.equal(slugify(heavier), slugify(lighter));
  });

  it("gives the two divisions different slugs", () => {
    assert.notEqual(slugify(disambiguateName(heavier)), slugify(disambiguateName(lighter)));
  });

  it("leaves a name with no plus untouched", () => {
    assert.equal(disambiguateName(lighter), lighter);
    assert.equal(
      disambiguateName("2023 World Wrestling Championships – Men's freestyle 74 kg"),
      "2023 World Wrestling Championships – Men's freestyle 74 kg",
    );
  });

  it("still reads as the same division to a human", () => {
    assert.equal(disambiguateName(heavier), "Taekwondo at the 2024 Summer Olympics – Men's over 80 kg");
  });
});

describe("dates", () => {
  it("handles every shape these infoboxes use", () => {
    assert.equal(parseWikiDate("7 August 2024")?.slice(0, 10), "2024-08-07");
    assert.equal(parseWikiDate("17–18 September 2023")?.slice(0, 10), "2023-09-17");
    // A range spanning two months: first day + first month, not "1 October".
    assert.equal(parseWikiDate("24 September – 1 October 2023")?.slice(0, 10), "2023-09-24");
    assert.equal(parseWikiDate("August 7, 2024")?.slice(0, 10), "2024-08-07");
  });

  it("returns null rather than guessing", () => {
    assert.equal(parseWikiDate("no date here"), null);
    assert.equal(parseWikiDate("2023"), null); // a year alone is not a date
    assert.equal(parseWikiDate(""), null);
  });

  it("stores midday, so a date-only fact cannot drift a day west of UTC", () => {
    assert.equal(parseWikiDate("7 August 2024"), "2024-08-07T12:00:00.000Z");
  });
});

describe("mapping to the canonical shape", () => {
  const card = (over: Partial<TournamentCard> = {}): TournamentCard => ({
    sourceTitle: "T",
    name: "T",
    division: "Men's freestyle 74 kg",
    date: "2024-08-09T12:00:00.000Z",
    venue: null,
    city: null,
    country: null,
    bouts: parseBrackets(WRESTLING),
    ...over,
  });

  it("makes the final the main event and a title bout", () => {
    const ev = toNormalizedEvent(card(), "WRESTLING", "United World Wrestling", 2);
    assert.ok(ev);
    const main = ev.fights?.[0];
    assert.ok(main?.mainEvent);
    assert.ok(main.titleFight);
    assert.equal(main.scheduledRounds, 2);
  });

  it("points the winner at a corner that exists on the bout", () => {
    const ev = toNormalizedEvent(card(), "WRESTLING", "United World Wrestling", 2);
    for (const f of ev?.fights ?? []) {
      if (f.result !== "WIN") continue;
      assert.ok(
        f.winnerExternalId === f.redExternalId || f.winnerExternalId === f.blueExternalId,
        "winnerExternalId matches neither corner — the result would be dropped",
      );
    }
  });

  it("never invents a method from a score", () => {
    const ev = toNormalizedEvent(card(), "WRESTLING", "United World Wrestling", 2);
    for (const f of ev?.fights ?? []) assert.equal(f.method, undefined);
  });

  it("refuses a card with no date instead of inventing one", () => {
    assert.equal(toNormalizedEvent(card({ date: null }), "WRESTLING", "UWW", 2), null);
  });

  it("refuses a card with no bouts", () => {
    assert.equal(toNormalizedEvent(card({ bouts: [] }), "WRESTLING", "UWW", 2), null);
  });

  it("marks a past card COMPLETED", () => {
    const ev = toNormalizedEvent(card(), "WRESTLING", "UWW", 2, new Date("2025-01-01"));
    assert.equal(ev?.status, "COMPLETED");
  });
});
