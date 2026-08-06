// ════════════════════════════════════════════════════════════════════════════
//  KEYSET CURSORS. No OFFSET, anywhere in this domain.
//
//  ── Why offset is not an option here ─────────────────────────────────────
//  A feed grows at the HEAD. `skip: 40` means "count 40 rows from the newest",
//  and by the time someone scrolls to page 3 the newest has moved — so the
//  reader is shown a row they already saw and, worse, silently skipped one they
//  never will. It also gets slower the further you scroll, because the database
//  still has to walk and discard every skipped row.
//
//  A keyset cursor says "everything strictly older than THIS row" instead. It
//  is stable under inserts, costs the same on page 300 as on page 1, and lands
//  directly on the (deletedAt, createdAt) index.
//
//  ── Why (createdAt, id) and not just createdAt ───────────────────────────
//  Two posts written in the same millisecond are not distinguishable by time
//  alone, and a cursor on time alone either repeats them or drops them. The id
//  is the tiebreaker, and it must be part of BOTH the sort and the seek or the
//  tie is broken differently by each and rows go missing.
//
//  ── Why it is opaque ─────────────────────────────────────────────────────
//  Base64 is not security — it is a contract. A cursor that looks like a
//  timestamp invites clients to construct one, and then the encoding can never
//  change. It is untrusted input regardless: a forged cursor only chooses where
//  to start scanning INSIDE the caller's own permitted result set, because the
//  visibility filter is a separate WHERE that the cursor cannot touch.
// ════════════════════════════════════════════════════════════════════════════

export interface Keyset {
  /** Milliseconds since epoch. Postgres stores timestamp(3), so this is exact. */
  at: number;
  id: string;
}

/** Encode a row position. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}:${id}`, "utf8").toString("base64url");
}

/**
 * Decode a client-supplied cursor.
 *
 * Returns null for anything malformed rather than throwing: a bad cursor is a
 * bad REQUEST, and a throw here would turn a mistyped query string into a 500.
 * The caller treats null as "start from the beginning".
 */
export function decodeCursor(raw: string | null | undefined): Keyset | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep <= 0) return null;

  const at = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  // Number("") is 0 and Number("12abc") is NaN — both have to fail, and an id
  // that is empty or absurdly long is a probe, not a page request.
  if (!Number.isSafeInteger(at) || at < 0) return null;
  if (!id || id.length > 64) return null;
  return { at, id };
}

export type SeekDirection = "older" | "newer";

/**
 * The WHERE fragment that resumes a scan.
 *
 * "older" pairs with `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`;
 * "newer" pairs with the ascending pair. Mixing a direction with the wrong sort
 * silently returns the wrong page, so both always come from here together —
 * see `seekOrderBy` below.
 */
export function seekWhere(k: Keyset | null, direction: SeekDirection = "older") {
  if (!k) return {};
  const at = new Date(k.at);
  return direction === "older"
    ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: k.id } }] }
    : { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: k.id } }] };
}

/** The sort that `seekWhere` assumes. Always taken from the same call site. */
export function seekOrderBy(direction: SeekDirection = "older") {
  const dir = direction === "older" ? ("desc" as const) : ("asc" as const);
  return [{ createdAt: dir }, { id: dir }];
}

/**
 * Turn an over-fetched result into a page and its next cursor.
 *
 * Every reader here fetches `limit + 1` rows so "is there more?" is answered by
 * the same query — a count() on a table with a year of history is the query
 * that gets expensive first.
 */
export function takePage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** Clamp a client-supplied page size. The ceiling is the point. */
export function pageSize(requested: unknown, fallback: number, max: number): number {
  const n = typeof requested === "number" ? requested : Number(requested);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}
