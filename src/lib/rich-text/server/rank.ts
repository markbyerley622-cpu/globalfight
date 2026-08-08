import "server-only";

// ════════════════════════════════════════════════════════════════════════════
//  Ranking a typeahead window against what was typed.
//
//  ── Why this is not done in SQL ───────────────────────────────────────────
//  Postgres has no cheap way to express "exact, then prefix, then word-start,
//  then anything" without either a trigram index we do not have or a CASE over
//  three ILIKE patterns evaluated per row. Both are worse than what this does:
//  the source fetches a BOUNDED window in the database's own cheap order and
//  this re-orders that handful in memory. It is never a scan — the window is
//  `limit * 4` at most.
//
//  ── Why it is shared ──────────────────────────────────────────────────────
//  It lived inside the fighter source. Gyms needed exactly the same ladder over
//  a different pair of columns, and copying it would have given the product two
//  rankings that agree today and drift the first time either is tuned — with no
//  symptom beyond "search feels worse for gyms", which nobody files a bug for.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Order `rows` by how well they match `q`, best first.
 *
 * `fields` returns the matchable strings for a row. The FIRST is primary — the
 * thing the row is actually called — and the rest are secondary identities (a
 * fighter's nickname, a gym's city). A primary prefix always beats a secondary
 * exact match, because somebody typing "syd" wants the gym called Sydney
 * something before the gym in Sydney.
 *
 * Ties keep the incoming order, which is the database's own ranking (verified
 * first, then popularity). That makes the result total and STABLE: the same
 * query always produces the same list, so a row does not shuffle position
 * between keystrokes.
 */
export function rankByMatch<T>(
  rows: T[],
  q: string,
  limit: number,
  fields: (row: T) => (string | null | undefined)[],
): T[] {
  const ql = q.toLowerCase();

  const band = (row: T): number => {
    const [primaryRaw, ...secondaryRaw] = fields(row);
    const primary = (primaryRaw ?? "").toLowerCase();
    const secondary = secondaryRaw.map((s) => (s ?? "").toLowerCase()).filter(Boolean);

    if (primary === ql) return 0;
    if (primary.startsWith(ql)) return 1;
    if (secondary.some((s) => s === ql || s.startsWith(ql))) return 2;
    // A match at the start of any WORD — "pereira" finding "Alex Pereira" —
    // beats one buried mid-token, which is usually incidental.
    if (primary.split(/\s+/).some((w) => w.startsWith(ql))) return 3;
    return 4;
  };

  return rows
    .map((row, i) => ({ row, i, b: band(row) }))
    .sort((x, y) => (x.b - y.b) || (x.i - y.i))
    .slice(0, limit)
    .map((x) => x.row);
}

/**
 * Merge per-kind result lists into ONE ranked list.
 *
 * Round-robin by rank position: every kind's best result, then every kind's
 * second, and so on until the total is reached.
 *
 * ── Why round-robin and not concatenation ─────────────────────────────────
 * Concatenating would let one family fill the menu. A search for "ufc" matches
 * dozens of events and exactly one promotion — take the first ten by any global
 * score and the promotion is buried, even though it is almost certainly what
 * was meant. Round-robin guarantees that EVERY kind which matched at all is
 * visible in the first round, which is what makes a mixed picker usable.
 *
 * ── Why this decides the GROUP order too ──────────────────────────────────
 * The client groups by kind in order of first appearance, so this function is
 * also the answer to "which heading comes first". That is deliberate: it means
 * no file anywhere contains "people before fighters", and a query that matches
 * an event best shows Events first. `lists` order therefore only breaks ties
 * within a round — it is not a priority list.
 *
 * Empty lists are skipped rather than reserving a slot, so a kind that matched
 * nothing costs the others nothing.
 */
export function interleaveByRank<T>(lists: T[][], total: number): T[] {
  const merged: T[] = [];
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth && merged.length < total; i++) {
    for (const list of lists) {
      if (merged.length >= total) break;
      if (list[i] !== undefined) merged.push(list[i]);
    }
  }
  return merged;
}
