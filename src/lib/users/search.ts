import "server-only";
import { prisma } from "@/lib/db";
import { PRESENCE_SELECT, type PresenceRow } from "@/lib/presence/select";

// ════════════════════════════════════════════════════════════════════════════
//  PEOPLE TYPEAHEAD — the query and the ranking, in one place.
//
//  ── Why this was extracted ────────────────────────────────────────────────
//  It lived inside /api/users/search. When the composer's picker grew to offer
//  fighters and events alongside people, the people half had to be callable
//  from the new entity source too — and the obvious move, writing the query
//  again over there, would have given the product two people-searches that
//  agree today and drift the first time either is tuned.
//
//  So the QUERY and the RANKING live here and have exactly one definition. The
//  two callers differ only in how they project the rows:
//
//    /api/users/search      → the challenge picker's DTO (unchanged)
//    rich-text/server/mention → an EntitySuggestion for the composer
//
//  Nothing about the existing endpoint's behaviour changed in the extraction.
// ════════════════════════════════════════════════════════════════════════════

/** Everything either caller projects from. */
export const PEOPLE_SEARCH_SELECT = {
  // `id` arrives via PRESENCE_SELECT, which carries it on purpose so the
  // presence DTO builder can recognise the viewer looking at their own row.
  username: true,
  name: true,
  image: true,
  professionalVerifiedAt: true,
  ...PRESENCE_SELECT,
} as const;

/**
 * The row shape `PEOPLE_SEARCH_SELECT` produces.
 *
 * Intersects `PresenceRow` rather than restating `lastSeenAt`,
 * `showOnlineStatus` and `showLastSeen` by hand. A hand-written list compiles
 * fine and is exactly what the no-raw-presence guard flags — correctly, because
 * it is the thing that goes stale the day a fifth privacy switch is added, and
 * the failure mode is a setting that silently does nothing on one surface.
 */
export type PeopleSearchRow = PresenceRow & {
  username: string | null;
  name: string | null;
  image: string | null;
  professionalVerifiedAt: Date | null;
};

/**
 * Re-rank so the viewer's own graph comes first.
 *
 * followed → verified → everything else, with the incoming order (reputation)
 * preserved WITHIN each band, so the ranking is total and stable rather than
 * shuffling between keystrokes.
 *
 * One extra query for the whole response, over the handful of ids being
 * returned — never one per row.
 */
async function rankByRelationship(
  rows: PeopleSearchRow[],
  viewerId: string,
  limit: number,
): Promise<PeopleSearchRow[]> {
  if (rows.length === 0) return rows;
  let followed = new Set<string>();
  try {
    const follows = await prisma.userFollow.findMany({
      where: { followerId: viewerId, followingId: { in: rows.map((r) => r.id) } },
      select: { followingId: true },
    });
    followed = new Set(follows.map((f) => f.followingId));
  } catch {
    // Ranking is an enhancement. A failed lookup must not fail the typeahead —
    // reputation order is still a usable answer.
  }
  const band = (r: PeopleSearchRow) => (followed.has(r.id) ? 0 : r.professionalVerifiedAt ? 1 : 2);
  return rows
    .map((r, i) => ({ r, i, b: band(r) }))
    .sort((x, y) => (x.b - y.b) || (x.i - y.i))
    .slice(0, limit)
    .map((x) => x.r);
}

/**
 * People matching `q`, ranked for the viewer.
 *
 * An EMPTY query is a real state, not a no-op: it returns the people the viewer
 * already follows, most recent first. That is what makes a picker useful on the
 * first keystroke — the person you are reaching for is nearly always somebody
 * you already have a relationship with.
 *
 * Requires a viewer. The rows themselves are public (each is a public
 * `/u/<handle>` page), but the EMPTY-query response is the viewer's own social
 * graph, so the whole function is viewer-scoped rather than serving two trust
 * levels from one path.
 */
export async function searchPeople(
  q: string,
  viewerId: string,
  limit: number,
): Promise<PeopleSearchRow[]> {
  const rows = q
    ? await prisma.user.findMany({
        where: {
          // A user with no username has no public page to send anyone to.
          username: { not: null },
          // Never offer the viewer themselves.
          id: { not: viewerId },
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
        // Handle matches first: someone typing "@jo" wants jo, not "Jo-Anne's"
        // display name. Postgres has no cheap "starts-with-first" ordering here,
        // so the tie-break is reputation — the accounts most likely to be real.
        orderBy: [{ reputation: "desc" }, { username: "asc" }],
        // Over-fetch, then re-rank below. The interesting ordering — people you
        // already follow first — cannot be expressed in this query without a
        // join that would make the common case slower for every keystroke.
        take: limit * 3,
        select: PEOPLE_SEARCH_SELECT,
      })
    : (
        await prisma.userFollow.findMany({
          where: { followerId: viewerId, following: { username: { not: null } } },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { following: { select: PEOPLE_SEARCH_SELECT } },
        })
      ).map((f) => f.following);

  return rankByRelationship(rows, viewerId, q ? limit : rows.length);
}
