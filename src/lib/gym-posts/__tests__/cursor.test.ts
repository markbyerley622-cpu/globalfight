// Keyset cursor tests. Pure — no database, no network.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { encodeCursor, decodeCursor, seekWhere, seekOrderBy, takePage, pageSize } from "../cursor";

const at = (ms: number) => new Date(ms);

describe("cursor encoding", () => {
  it("round-trips a position exactly", () => {
    const cursor = encodeCursor(at(1_700_000_000_123), "clx123");
    assert.deepEqual(decodeCursor(cursor), { at: 1_700_000_000_123, id: "clx123" });
  });

  it("is opaque — it does not read as a timestamp", () => {
    const cursor = encodeCursor(at(1_700_000_000_000), "abc");
    assert.ok(!cursor.includes("1700000000000"));
    assert.ok(!cursor.includes(":"));
  });

  it("preserves MILLISECONDS, which is what breaks ties", () => {
    // Two posts one millisecond apart are two distinct positions. Truncating to
    // seconds would make them the same cursor, and one of them would be skipped
    // or repeated on every page boundary that landed between them.
    const a = decodeCursor(encodeCursor(at(1_700_000_000_001), "x"))!;
    const b = decodeCursor(encodeCursor(at(1_700_000_000_002), "x"))!;
    assert.notEqual(a.at, b.at);
  });

  it("survives an id containing a colon", () => {
    // The encoding splits on the FIRST colon. An id with one in it would be
    // truncated by a naive split(":").
    assert.deepEqual(decodeCursor(encodeCursor(at(1000), "a:b:c")), { at: 1000, id: "a:b:c" });
  });
});

describe("cursor decoding refuses bad input", () => {
  // A cursor is untrusted input from a query string. Every one of these must
  // return null — "start from the beginning" — and never throw, because a throw
  // turns a mistyped URL into a 500.
  const bad = [
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["not base64", "!!!!"],
    ["no separator", Buffer.from("1700000000000").toString("base64url")],
    ["empty id", Buffer.from("1700000000000:").toString("base64url")],
    ["non-numeric time", Buffer.from("later:abc").toString("base64url")],
    ["negative time", Buffer.from("-5:abc").toString("base64url")],
    ["float time", Buffer.from("1.5:abc").toString("base64url")],
    ["absurd id", Buffer.from(`1:${"x".repeat(200)}`).toString("base64url")],
  ] as const;

  for (const [name, value] of bad) {
    it(`returns null for ${name}`, () => {
      assert.equal(decodeCursor(value as string | null | undefined), null);
    });
  }
});

describe("seek", () => {
  it("with no cursor, constrains nothing", () => {
    assert.deepEqual(seekWhere(null), {});
  });

  it("resumes strictly BELOW the cursor row when scanning older", () => {
    // The compound condition is the whole point: rows in the same millisecond
    // are separated by id, so the cursor row itself is excluded exactly once and
    // its same-millisecond neighbours are not skipped.
    const where = seekWhere({ at: 1000, id: "m" }, "older") as {
      OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
    };
    assert.equal(where.OR[0].createdAt.lt.getTime(), 1000);
    assert.equal(where.OR[1].createdAt.getTime(), 1000);
    assert.equal(where.OR[1].id.lt, "m");
  });

  it("mirrors the comparison when scanning newer", () => {
    const where = seekWhere({ at: 1000, id: "m" }, "newer") as {
      OR: [{ createdAt: { gt: Date } }, { createdAt: Date; id: { gt: string } }];
    };
    assert.equal(where.OR[0].createdAt.gt.getTime(), 1000);
    assert.equal(where.OR[1].id.gt, "m");
  });

  it("orders in the SAME direction it seeks", () => {
    // A seek in one direction with a sort in the other silently returns the
    // wrong page, so these two always come from the same call site.
    assert.deepEqual(seekOrderBy("older"), [{ createdAt: "desc" }, { id: "desc" }]);
    assert.deepEqual(seekOrderBy("newer"), [{ createdAt: "asc" }, { id: "asc" }]);
  });
});

describe("takePage", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `id${i}`, createdAt: at(1000 + i) }));

  it("answers 'is there more' from the over-fetched row, not a count query", () => {
    const { items, nextCursor } = takePage(rows(4), 3);
    assert.equal(items.length, 3);
    assert.ok(nextCursor);
    // The cursor points at the LAST RETURNED row, not the over-fetched one —
    // pointing at the extra row would skip it on the next page.
    assert.deepEqual(decodeCursor(nextCursor), { at: 1002, id: "id2" });
  });

  it("reports the end of the list as a null cursor", () => {
    const { items, nextCursor } = takePage(rows(3), 3);
    assert.equal(items.length, 3);
    assert.equal(nextCursor, null);
  });

  it("handles an empty result", () => {
    assert.deepEqual(takePage([], 10), { items: [], nextCursor: null });
  });

  it("never repeats or drops a row across consecutive pages", () => {
    // The property that matters. Walk the whole list one page at a time and
    // assert the union is exactly the input, with no duplicates.
    const all = rows(11);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      // Copied into a const before the closure below reads it: capturing the
      // mutable binding directly makes its type depend on the assignment at the
      // bottom of the loop, which depends on this line — a genuine inference
      // cycle, not a lint quibble.
      const at: string | null = cursor;
      const from: number = at ? all.findIndex((r) => r.id === decodeCursor(at)!.id) + 1 : 0;
      const page: { items: { id: string }[]; nextCursor: string | null } = takePage(all.slice(from), 3);
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, all.map((r) => r.id));
    assert.equal(new Set(seen).size, seen.length, "no row appears twice");
  });
});

describe("pageSize", () => {
  it("falls back when the client sends nonsense", () => {
    assert.equal(pageSize(undefined, 20, 50), 20);
    assert.equal(pageSize("abc", 20, 50), 20);
    assert.equal(pageSize(NaN, 20, 50), 20);
  });

  it("clamps to the ceiling — the point of the function", () => {
    assert.equal(pageSize(10_000, 20, 50), 50);
    assert.equal(pageSize(0, 20, 50), 1);
    assert.equal(pageSize(-5, 20, 50), 1);
  });

  it("accepts a legitimate request", () => {
    assert.equal(pageSize(35, 20, 50), 35);
    assert.equal(pageSize("35", 20, 50), 35);
  });
});
