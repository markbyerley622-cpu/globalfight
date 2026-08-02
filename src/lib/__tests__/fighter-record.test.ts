import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFromHistory, resolveFighterRecord, canShowStreak } from "@/lib/fighters/record";
import type { Fight, Fighter } from "@/lib/types";

// Rose Namajunas's profile showed a 0-0-0 donut and three large zeros directly
// above a fight history listing five of her bouts WITH results. The stored
// record columns are filled by a record-importing provider; the fight history is
// built by a different pipeline. When the first has not covered a fighter, 0 is
// indistinguishable from "has never competed" by the time it reaches a chart.

function fighter(id: string, slug: string): Fighter {
  return {
    id, slug, name: slug, sport: "MMA",
    wins: 0, losses: 0, draws: 0, noContests: 0,
    koWins: 0, koLosses: 0, totalRounds: 0, active: true,
  };
}

const rose = fighter("f-rose", "rose-namajunas");
const opp = (n: string) => fighter(`f-${n}`, n);

function bout(over: Partial<Fight>): Fight {
  return {
    id: "b", slug: "b", red: rose, blue: opp("x"),
    scheduledRounds: 5, titleFight: false, mainEvent: false, coMain: false,
    result: "WIN", winnerId: rose.id, date: "2026-01-01T00:00:00Z",
    ...over,
  } as Fight;
}

// ── recordFromHistory ─────────────────────────────────────────────────────

test("counts wins and losses from whichever corner the fighter occupied", () => {
  const a = opp("a"), b = opp("b"), c = opp("c");
  const h = recordFromHistory(
    [
      bout({ id: "1", red: rose, blue: a, winnerId: rose.id }),  // W (red)
      bout({ id: "2", red: b, blue: rose, winnerId: rose.id }),  // W (blue)
      bout({ id: "3", red: rose, blue: c, winnerId: c.id }),     // L (red)
      bout({ id: "4", red: a, blue: rose, winnerId: a.id }),     // L (blue)
    ],
    rose.slug,
  );
  assert.deepEqual(h, { wins: 2, losses: 2, draws: 0, noContests: 0, counted: 4 });
});

test("draws and no-contests are counted as themselves, never as losses", () => {
  const h = recordFromHistory(
    [
      bout({ id: "1", result: "DRAW", winnerId: undefined }),
      bout({ id: "2", result: "NO_CONTEST", winnerId: undefined }),
    ],
    rose.slug,
  );
  assert.equal(h.draws, 1);
  assert.equal(h.noContests, 1);
  assert.equal(h.losses, 0);
});

test("scheduled, cancelled and unattributable bouts are not counted", () => {
  const h = recordFromHistory(
    [
      bout({ id: "1", result: "SCHEDULED", winnerId: undefined }),
      bout({ id: "2", cancelled: true }),
      // decided, but the winner matches neither corner — a guess is not a record
      bout({ id: "3", result: "WIN", winnerId: "someone-else" }),
    ],
    rose.slug,
  );
  assert.equal(h.counted, 0);
});

test("another fighter's bouts never leak into the count", () => {
  const h = recordFromHistory([bout({ id: "1", red: opp("a"), blue: opp("b"), winnerId: "f-a" })], rose.slug);
  assert.equal(h.counted, 0);
});

test("the fighter is matched by id as well as slug", () => {
  const byId = recordFromHistory([bout({ winnerId: rose.id })], rose.id);
  assert.equal(byId.wins, 1);
});

// ── resolveFighterRecord ──────────────────────────────────────────────────

test("an imported record wins and is reported as stored", () => {
  const r = resolveFighterRecord({ wins: 14, losses: 6, draws: 0 }, [bout({})], rose.slug);
  assert.equal(r?.source, "stored");
  assert.equal(r?.wins, 14);
});

test("THE BUG: no imported record but real history derives instead of showing 0-0-0", () => {
  const r = resolveFighterRecord(
    { wins: 0, losses: 0, draws: 0 },
    [
      bout({ id: "1", winnerId: rose.id }),
      bout({ id: "2", winnerId: rose.id }),
      bout({ id: "3", red: rose, blue: opp("c"), winnerId: "f-c" }),
    ],
    rose.slug,
  );
  assert.equal(r?.source, "derived");
  assert.equal(r?.wins, 2);
  assert.equal(r?.losses, 1);
  assert.equal(r?.countedBouts, 3);
});

test("nothing stored and nothing settled returns null — the block is hidden", () => {
  assert.equal(resolveFighterRecord({ wins: 0, losses: 0, draws: 0 }, [], rose.slug), null);
  assert.equal(
    resolveFighterRecord({ wins: 0, losses: 0, draws: 0 }, [bout({ result: "SCHEDULED", winnerId: undefined })], rose.slug),
    null,
  );
});

test("a stored record of only no-contests still counts as stored", () => {
  const r = resolveFighterRecord({ wins: 0, losses: 0, draws: 0, noContests: 1 }, [], rose.slug);
  assert.equal(r?.source, "stored");
});

// ── canShowStreak ─────────────────────────────────────────────────────────

test("no record means no streak", () => {
  assert.equal(canShowStreak(null, 10), false);
});

test("a single bout is not a streak", () => {
  // "1-fight skid" off the only bout we hold describes our ingest, not the fighter.
  const r = resolveFighterRecord({ wins: 3, losses: 1, draws: 0 }, [], rose.slug);
  assert.equal(canShowStreak(r, 1), false);
  assert.equal(canShowStreak(r, 0), false);
  assert.equal(canShowStreak(r, 2), true);
});
