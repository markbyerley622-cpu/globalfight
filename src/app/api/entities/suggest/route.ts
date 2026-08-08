import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { suggestEntities } from "@/lib/rich-text/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  GET /api/entities/suggest?q= — what the composer's "@" menu offers.
//
//  The typeahead counterpart to /api/entities/preview, and the same shape of
//  thing: one door, every kind, the registry deciding which kinds answer.
//
//  ── Why this is not /api/search ──────────────────────────────────────────
//  /api/search is the universal overlay — nine families, plus follow state
//  batched across all of them, plus static page destinations. Typing four
//  characters into a composer would run all nine and throw six away, on every
//  keystroke. This asks only the kinds a composer can actually insert, which
//  today is three and is decided by which sources implement `suggest`.
//
//  ── Why it is not /api/users/search either ───────────────────────────────
//  That endpoint still exists and still serves the challenge picker unchanged.
//  Its people query is shared with this one (lib/users/search), so there is one
//  definition of "find a person" — this route adds fighters and events beside
//  it rather than replacing it.
//
//  ── Access-control walk (CLAUDE.md rules 1–8) ────────────────────────────
//  1. Authentication REQUIRED. Not because fighters or events are private —
//     they are public directories — but because the people half returns the
//     viewer's own follows on an empty query, and a composer is a signed-in
//     surface anyway. One trust level per path.
//  2. Ownership/visibility is enforced by each SOURCE, in the service layer, so
//     a second caller of suggestEntities cannot bypass it. Draft events are
//     excluded by PUBLIC_EVENT inside the event source — and, critically, by
//     the same predicate in its `resolve`, so filtering here is not the only
//     thing standing between a draft and a stored reference.
//  3–5. Nothing writes.
//  6. No existence oracle: a query that matches nothing returns an empty list,
//     identically to one whose matches were all filtered.
//  7. No outbound fetch from user input.
//  8. GET, and non-mutating.
//
//  Rate-limited under the shared `interaction` ceiling, keyed to the account:
//  this is a per-keystroke read that fans out across three tables.
// ════════════════════════════════════════════════════════════════════════════

/** Per KIND. Keeps any one family from crowding the menu. */
const PER_KIND = 5;

/** Total rows returned. A menu, not a page — see the picker's own note. */
const TOTAL = 10;

export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    // An empty list, not a 401. The composer treats "no suggestions" as a
    // normal state and simply does not open the menu; a 401 would put an error
    // path into a keystroke handler for a case that is not an error.
    return NextResponse.json({ suggestions: [] }, { headers: { "cache-control": "private, no-store" } });
  }

  const limited = await enforceLimit(req, "entity-suggest", POLICY.interaction, user.id);
  if (limited) return limited;

  // A leading "@" is how people write a handle; it is not part of one.
  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/^@+/, "");
  const q = raw.slice(0, 64);

  const suggestions = await suggestEntities(q, { viewerId: user.id }, PER_KIND, TOTAL);

  return NextResponse.json(
    { suggestions },
    // Viewer-dependent (the people half is ranked by who you follow) and cheap
    // to recompute. A shared cache would serve one person's graph to everybody.
    { headers: { "cache-control": "private, no-store" } },
  );
}
