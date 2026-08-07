import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { publicDisplayName } from "@/lib/display-name";
import { PRESENCE_SELECT } from "@/lib/presence/select";
import { presenceDtoFor } from "@/lib/presence/policy";

/**
 * PEOPLE autocomplete — the typeahead behind "Challenge a friend".
 *
 * ── Why this is not /api/search ─────────────────────────────────────────────
 * /api/search is the universal overlay: it fans out across nine families and
 * batches follow state for all of them. Typing four characters into a friend
 * picker would run all nine and throw eight away, on every keystroke. This is
 * the one family, one query, no follow batch.
 *
 * ── Why it is signed-in only ────────────────────────────────────────────────
 * The ROWS are public (every one of them is a public /u/<username> page, and
 * /api/search already returns the same fields to anyone). What is not public is
 * the EMPTY-QUERY response: with no `q` this returns the people the viewer
 * follows, which is the viewer's own social graph. Rather than serve two
 * different trust levels from one path, the whole endpoint requires a session —
 * a signed-out reader has no friend to challenge anyway.
 *
 * Access-control walk (CLAUDE.md rules 1–8): read-only GET, authenticated
 * first (rule 1), owner-scoped — the suggestion query filters on
 * `followerId: user.id` and can only ever read the viewer's own follows
 * (rule 1/RLS Group A); no columns beyond the public four are selected, and
 * nothing here writes, so rules 3–5 and 8 do not apply. Rate-limited under the
 * shared `interaction` ceiling because it is a per-keystroke read.
 */

/** Never ship an unbounded people list to a typeahead. */
const LIMIT = 8;

/**
 * Re-rank a candidate list so the viewer's own graph comes first.
 *
 * followed → verified → everything else, and the incoming order (reputation)
 * is preserved WITHIN each band, so the ranking is total and stable rather than
 * shuffling between keystrokes.
 *
 * `rows` is already capped, so the follow lookup is a single indexed query over
 * a handful of ids.
 */
async function rankByRelationship<T extends { id: string; professionalVerifiedAt: Date | null }>(
  rows: T[],
  viewerId: string,
  limit: number,
): Promise<T[]> {
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
  const band = (r: T) => (followed.has(r.id) ? 0 : r.professionalVerifiedAt ? 1 : 2);
  return rows
    .map((r, i) => ({ r, i, b: band(r) }))
    .sort((x, y) => (x.b - y.b) || (x.i - y.i))
    .slice(0, limit)
    .map((x) => x.r);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to find people." }, { status: 401 });

  const limited = await enforceLimit(req, "user-search", POLICY.interaction, user.id);
  if (limited) return limited;

  // A leading "@" is how people write a handle; it is not part of one.
  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/^@+/, "");
  const q = raw.slice(0, 64);

  // PRESENCE_SELECT rather than the columns by hand — "are they around right
  // now" is exactly the signal that decides who you challenge, and the shared
  // fragment keeps a future switch reaching this query too.
  const select = {
    username: true, name: true, image: true,
    professionalVerifiedAt: true,
    ...PRESENCE_SELECT,
  } as const;

  const rows = q
    ? await prisma.user.findMany({
        where: {
          // A user with no username has no public page to send anyone to.
          username: { not: null },
          // Never offer the viewer themselves: challengeUser refuses it, so the
          // row would be a guaranteed dead end.
          id: { not: user.id },
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
        take: LIMIT * 3,
        select,
      })
    : // SUGGESTIONS: the people you already follow, most recent first. This is
      // what makes the picker useful on the first tap, before a single
      // character is typed — the friend you want to challenge is almost always
      // someone you already follow.
      (
        await prisma.userFollow.findMany({
          where: { followerId: user.id, following: { username: { not: null } } },
          orderBy: { createdAt: "desc" },
          take: LIMIT,
          select: { following: { select } },
        })
      ).map((f) => f.following);

  // ── Ranking ──────────────────────────────────────────────────────────────
  // A name match is not a useful ordering on its own: typing "ma" on a platform
  // with ten thousand accounts returns ten strangers before the friend you were
  // reaching for. People you FOLLOW come first, because a mention is nearly
  // always aimed at somebody you already have a relationship with.
  //
  // One extra query for the whole response, not one per row, and only for the
  // handful of ids actually being returned.
  const ranked = await rankByRelationship(rows, user.id, q ? LIMIT : rows.length);

  return NextResponse.json({
    suggested: !q,
    people: ranked.flatMap((u) =>
      u.username
        ? [{
            username: u.username,
            // publicDisplayName, never `u.name` — signup stores whatever was
            // typed into the display-name field and people type their email
            // address there. See lib/display-name.
            name: publicDisplayName(u),
            image: u.image,
            verified: u.professionalVerifiedAt !== null,
            presence: presenceDtoFor(u, user.id),
          }]
        : [],
    ),
  });
}

export const dynamic = "force-dynamic";
