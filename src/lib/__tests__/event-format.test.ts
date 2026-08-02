import { test } from "node:test";
import assert from "node:assert/strict";
import { winningCorner, boutOutcomeView } from "@/lib/event-format";
import type { Fight, Fighter } from "@/lib/types";

// The audit's #1 trust failure: /results showed Marina Spasić beating Stephanie
// Luciano and Archie Colgan beating Usman Nurmagomedov, while the event detail
// page showed the opposite (and was right). The cause was one expression —
// `fight.winnerId === fight.red.slug` — comparing a Fighter *id* to a *slug*. It
// is false for every row in the database, so the page silently credited the BLUE
// corner with winning every fight ever listed.
//
// These tests exist so a winner can never again be decided by corner position.

function fighter(over: Partial<Fighter> & Pick<Fighter, "id" | "slug" | "name">): Fighter {
  return {
    sport: "MMA",
    wins: 0, losses: 0, draws: 0, noContests: 0,
    koWins: 0, koLosses: 0, totalRounds: 0,
    active: true,
    ...over,
  };
}

const red = fighter({ id: "ckred00000", slug: "usman-nurmagomedov", name: "Usman Nurmagomedov" });
const blue = fighter({ id: "ckblue00000", slug: "archie-colgan", name: "Archie Colgan" });

function bout(over: Partial<Fight> = {}): Fight {
  return {
    id: "f1", slug: "usman-vs-archie",
    red, blue,
    scheduledRounds: 5, titleFight: true, mainEvent: true, coMain: false,
    result: "WIN", winnerId: red.id,
    date: "2026-06-01T00:00:00Z",
    ...over,
  } as Fight;
}

// ── winningCorner ─────────────────────────────────────────────────────────

test("the winner is the stored id, not the corner", () => {
  assert.equal(winningCorner(bout({ winnerId: red.id })), "red");
  assert.equal(winningCorner(bout({ winnerId: blue.id })), "blue");
});

test("a slug-valued winnerId still resolves (seed and legacy provider rows)", () => {
  assert.equal(winningCorner(bout({ winnerId: red.slug })), "red");
  assert.equal(winningCorner(bout({ winnerId: blue.slug })), "blue");
});

test("no corner is credited when the bout is not a decided win", () => {
  assert.equal(winningCorner(bout({ result: "SCHEDULED", winnerId: undefined })), null);
  assert.equal(winningCorner(bout({ result: "DRAW", winnerId: undefined })), null);
  assert.equal(winningCorner(bout({ result: "NO_CONTEST", winnerId: undefined })), null);
});

test("a WIN whose winnerId matches neither corner names nobody", () => {
  // The invalid state the importer guard is meant to prevent. If it ever reaches
  // the reader it must read as unknown, never as a win for the default corner.
  assert.equal(winningCorner(bout({ winnerId: "ck-someone-else" })), null);
});

// ── boutOutcomeView ───────────────────────────────────────────────────────

test("a win names the fighter the id points at", () => {
  const v = boutOutcomeView(bout({ winnerId: red.id }));
  assert.equal(v.kind, "win");
  assert.equal(v.kind === "win" && v.winner.name, "Usman Nurmagomedov");
  assert.equal(v.kind === "win" && v.loser.name, "Archie Colgan");
});

test("the regression itself: red winning must not render as blue winning", () => {
  const v = boutOutcomeView(bout({ winnerId: red.id }));
  assert.notEqual(v.kind === "win" && v.winner.slug, blue.slug);
});

test("draw, no-contest, cancellation and pending never name a winner", () => {
  for (const [f, kind] of [
    [bout({ result: "DRAW", winnerId: undefined }), "draw"],
    [bout({ result: "NO_CONTEST", winnerId: undefined }), "no-contest"],
    [bout({ cancelled: true }), "cancelled"],
    [bout({ result: "SCHEDULED", winnerId: undefined }), "pending"],
  ] as const) {
    const v = boutOutcomeView(f);
    assert.equal(v.kind, kind);
    assert.equal("winner" in v, false);
  }
});

test("cancellation outranks a stale recorded result", () => {
  // A bout pulled from the card keeps its row; it must not still be reported as won.
  assert.equal(boutOutcomeView(bout({ cancelled: true, winnerId: red.id })).kind, "cancelled");
});
