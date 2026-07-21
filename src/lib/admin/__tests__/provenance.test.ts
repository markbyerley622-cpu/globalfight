import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripLocked, withLocked, lockableEventFields, lockableFightFields,
} from "../provenance";

// The single most safety-critical rule in the admin: an operator's edit must
// survive the next cron run. If these break, every manual correction silently
// reverts within hours and the editor becomes decoration.

test("stripLocked removes locked keys and keeps the rest", () => {
  const out = stripLocked({ name: "A", venue: "B", date: "C" }, ["name"]);
  assert.equal("name" in out, false);
  assert.equal(out.venue, "B");
  assert.equal(out.date, "C");
});

test("stripLocked with no locks passes everything through", () => {
  const input = { a: 1, b: 2 };
  assert.deepEqual(stripLocked(input, []), input);
});

test("stripLocked can empty a payload entirely", () => {
  assert.deepEqual(stripLocked({ a: 1 }, ["a"]), {});
});

test("stripLocked does not mutate its input", () => {
  const input = { a: 1, b: 2 };
  stripLocked(input, ["a"]);
  assert.deepEqual(input, { a: 1, b: 2 });
});

test("withLocked unions, dedupes and sorts", () => {
  assert.deepEqual(withLocked(["venue"], ["name", "venue"]), ["name", "venue"]);
  assert.deepEqual(withLocked([], []), []);
});

test("only allow-listed fields can be locked", () => {
  // A caller must never be able to freeze an arbitrary column — notably not
  // updatedAt or a relation, which would wedge ingest permanently.
  assert.deepEqual(lockableEventFields(["venue", "updatedAt", "id", "date"]), ["venue", "date"]);
  assert.deepEqual(lockableFightFields(["orderOnCard", "createdAt", "result"]), ["orderOnCard", "result"]);
});

test("orderOnCard is lockable — drag-and-drop depends on it", () => {
  // The ingest pipeline rebuilds orderOnCard from the source's own index on
  // every run, so without this lock a reordered card reverts on the next cron.
  assert.deepEqual(lockableFightFields(["orderOnCard"]), ["orderOnCard"]);
  assert.equal("orderOnCard" in stripLocked({ orderOnCard: 5 }, ["orderOnCard"]), false);
});
