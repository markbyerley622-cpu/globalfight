// ════════════════════════════════════════════════════════════════════════════
//  Reading intent out of a search box.
//
//  One rule today — a leading "@" means "find me a person" — but it is the rule
//  that decides which of nine family queries run, so it is worth being pure and
//  tested rather than three lines inside a route handler that needs Postgres to
//  exercise.
//
//  ── Why "@" narrows rather than merely strips ─────────────────────────────
//  Typing "@alex" used to return nothing at all: the sigil went into the query
//  verbatim and no username or display name contains one. Stripping it fixes
//  that much. But "@alex" is not the same question as "alex" — it names a
//  person, and answering it with a fighter, an event and three articles beside
//  the one row that was asked for is noise. Every product people already use
//  reads it the same way, and this app's own composer has since Phase 4.
//
//  PURE: no prisma, no env, no React.
// ════════════════════════════════════════════════════════════════════════════

export interface SearchQuery {
  /** What to match on. The sigil is removed. */
  q: string;
  /** True when the reader asked for a PERSON specifically. */
  handleQuery: boolean;
}

/**
 * Split a raw search box value into a term and an intent.
 *
 * A bare "@" yields an EMPTY term, which callers treat as "no query" — it is a
 * real state while typing and it is not a request for the whole user table.
 * Repeated sigils ("@@alex") are tolerated for the same reason a stray one is:
 * somebody is typing, and refusing to parse it would just show them nothing.
 */
export function parseSearchQuery(raw: string): SearchQuery {
  const trimmed = (raw ?? "").trim();
  if (!trimmed.startsWith("@")) return { q: trimmed, handleQuery: false };
  return { q: trimmed.replace(/^@+/, "").trim(), handleQuery: true };
}
