import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWatch, resolveTickets } from "../providers";

test("watch: known promotions resolve to their primary broadcaster + official URL", () => {
  const ufc = resolveWatch("UFC", null, null);
  assert.equal(ufc?.label, "ESPN+");
  assert.match(ufc!.url, /ufc\.com/);
  assert.equal(ufc?.exact, false);

  assert.equal(resolveWatch("ONE Championship", null, null)?.label, "Prime Video");
  assert.equal(resolveWatch("BKFC", null, null)?.label, "BKFC App");
  assert.equal(resolveWatch("PFL", null, null)?.label, "ESPN");
});

test("watch: explicit feed broadcaster + URL WINS over the promotion default", () => {
  const w = resolveWatch("UFC", "DAZN", "https://dazn.com/x");
  assert.equal(w?.label, "DAZN");
  assert.equal(w?.url, "https://dazn.com/x");
  assert.equal(w?.exact, true);
});

test("watch: unknown/various promotion → null (card shows TBA)", () => {
  assert.equal(resolveWatch("Multiple promotions", null, null), null);
  assert.equal(resolveWatch("Boxing", null, null), null);
  assert.equal(resolveWatch(null, null, null), null);
});

test("watch: a broadcaster with no link is still named (no navigation)", () => {
  const w = resolveWatch("Boxing", "DAZN", null);
  assert.equal(w?.label, "DAZN");
  assert.equal(w?.url, "");
  assert.equal(w?.exact, true);
});

test("watch: a non-http event URL does not become a link", () => {
  // No known promotion + junk url → falls through to null.
  assert.equal(resolveWatch("Boxing", null, "javascript:alert(1)"), null);
});

test("tickets: explicit ticket URL wins with a Buy label", () => {
  const t = resolveTickets("UFC", "https://ticketmaster.com/x");
  assert.equal(t?.label, "Buy");
  assert.equal(t?.url, "https://ticketmaster.com/x");
  assert.equal(t?.exact, true);
});

test("tickets: known promotion → official ticketing home", () => {
  const one = resolveTickets("ONE Championship", null);
  assert.equal(one?.label, "ONE");
  assert.match(one!.url, /onefc\.com/);
  assert.equal(one?.exact, false);
});

test("tickets: unknown promotion → null (TBA)", () => {
  assert.equal(resolveTickets("Multiple promotions", null), null);
  assert.equal(resolveTickets(null, null), null);
});

test("watch: unknown promotion WITH an event name falls back to an honest search", () => {
  const w = resolveWatch("Various", null, null, "Tyson Fury vs Mariusz Wach");
  assert.equal(w?.label, "Find stream");
  assert.match(w!.url, /google\.com\/search/);
  assert.match(w!.url, /Tyson%20Fury/);
  assert.equal(w?.exact, false);
});

test("tickets: unknown promotion WITH an event name falls back to a ticket search", () => {
  const t = resolveTickets("Various", null, "Anthony Joshua vs Kristian Prenga");
  assert.equal(t?.label, "Find tickets");
  assert.match(t!.url, /google\.com\/search/);
  assert.match(t!.url, /tickets/);
});

test("known promotion still beats the search fallback even with an event name", () => {
  assert.equal(resolveWatch("ONE Championship", null, null, "ONE 170")?.label, "Prime Video");
  assert.equal(resolveTickets("BKFC", null, "BKFC 99")?.label, "BKFC");
});
