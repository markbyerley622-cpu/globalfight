import { test } from "node:test";
import assert from "node:assert/strict";
import { recordsByDiscipline } from "@/lib/fighters/record";
import type { Fight, Fighter } from "@/lib/types";

// A fighter's Muay Thai record and their MMA record are different facts. The
// single headline record merges them, which for a crossover athlete produces a
// number that describes nobody.

function fighter(id: string, slug: string): Fighter {
  return {
    id, slug, name: slug, sport: "MUAY_THAI",
    wins: 0, losses: 0, draws: 0, noContests: 0,
    koWins: 0, koLosses: 0, totalRounds: 0, active: true,
  };
}

const me = fighter("f-me", "superlek");
const opp = (n: string) => fighter(`f-${n}`, n);

function bout(over: Partial<Fight>): Fight {
  return {
    id: "b", slug: "b", red: me, blue: opp("x"),
    scheduledRounds: 3, titleFight: false, mainEvent: false, coMain: false,
    result: "WIN", winnerId: me.id, ruleset: "MUAY_THAI",
    date: "2026-01-01T00:00:00Z",
    ...over,
  } as Fight;
}

test("records are split by discipline and never summed", () => {
  const { records } = recordsByDiscipline(
    [
      bout({ id: "1", ruleset: "MUAY_THAI", winnerId: me.id }),
      bout({ id: "2", ruleset: "MUAY_THAI", winnerId: me.id }),
      bout({ id: "3", ruleset: "MUAY_THAI", red: opp("a"), blue: me, winnerId: "f-a" }),
      bout({ id: "4", ruleset: "KICKBOXING", winnerId: me.id }),
      bout({ id: "5", ruleset: "MMA", red: opp("b"), blue: me, winnerId: "f-b" }),
    ],
    me.slug,
  );

  assert.deepEqual(records.map((r) => r.ruleset), ["MUAY_THAI", "KICKBOXING", "MMA"]);
  assert.deepEqual(
    records.find((r) => r.ruleset === "MUAY_THAI"),
    { ruleset: "MUAY_THAI", wins: 2, losses: 1, draws: 0, noContests: 0, bouts: 3 },
  );
  assert.equal(records.find((r) => r.ruleset === "KICKBOXING")?.wins, 1);
  assert.equal(records.find((r) => r.ruleset === "MMA")?.losses, 1);
});

test("the discipline with the most bouts leads", () => {
  const { records } = recordsByDiscipline(
    [
      bout({ id: "1", ruleset: "MMA" }),
      bout({ id: "2", ruleset: "MUAY_THAI" }),
      bout({ id: "3", ruleset: "MUAY_THAI" }),
      bout({ id: "4", ruleset: "MUAY_THAI" }),
    ],
    me.slug,
  );
  assert.equal(records[0].ruleset, "MUAY_THAI");
});

test("UNKNOWN bouts are counted separately, never folded into a discipline", () => {
  // An honest "2 bouts we cannot categorise" beats a wrong total.
  const { records, unknown } = recordsByDiscipline(
    [
      bout({ id: "1", ruleset: "MUAY_THAI" }),
      bout({ id: "2", ruleset: "UNKNOWN" }),
      bout({ id: "3", ruleset: null }),
    ],
    me.slug,
  );
  assert.equal(unknown, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].bouts, 1);
});

test("draws and no-contests are their own columns", () => {
  const { records } = recordsByDiscipline(
    [
      bout({ id: "1", ruleset: "MUAY_THAI", result: "DRAW", winnerId: undefined }),
      bout({ id: "2", ruleset: "MUAY_THAI", result: "NO_CONTEST", winnerId: undefined }),
    ],
    me.slug,
  );
  assert.equal(records[0].draws, 1);
  assert.equal(records[0].noContests, 1);
  assert.equal(records[0].losses, 0);
});

test("scheduled and cancelled bouts are not a record", () => {
  const { records, unknown } = recordsByDiscipline(
    [
      bout({ id: "1", result: "SCHEDULED", winnerId: undefined }),
      bout({ id: "2", cancelled: true }),
    ],
    me.slug,
  );
  assert.deepEqual(records, []);
  assert.equal(unknown, 0);
});

test("another fighter's bouts never leak in", () => {
  const { records } = recordsByDiscipline(
    [bout({ id: "1", red: opp("a"), blue: opp("b"), winnerId: "f-a" })],
    me.slug,
  );
  assert.deepEqual(records, []);
});

test("a decided bout with no attributable winner counts as a bout, credited to neither", () => {
  const { records } = recordsByDiscipline(
    [bout({ id: "1", ruleset: "MUAY_THAI", winnerId: "someone-else" })],
    me.slug,
  );
  assert.equal(records[0].bouts, 1);
  assert.equal(records[0].wins, 0);
  assert.equal(records[0].losses, 0);
});
