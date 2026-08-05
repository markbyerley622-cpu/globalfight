import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";
import { publicDisplayName } from "@/lib/display-name";

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

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to find people." }, { status: 401 });

  const limited = await enforceLimit(req, "user-search", POLICY.interaction, user.id);
  if (limited) return limited;

  // A leading "@" is how people write a handle; it is not part of one.
  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/^@+/, "");
  const q = raw.slice(0, 64);

  const select = { id: true, username: true, name: true, image: true } as const;

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
        take: LIMIT,
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

  return NextResponse.json({
    suggested: !q,
    people: rows.flatMap((u) =>
      u.username
        ? [{
            username: u.username,
            // publicDisplayName, never `u.name` — signup stores whatever was
            // typed into the display-name field and people type their email
            // address there. See lib/display-name.
            name: publicDisplayName(u),
            image: u.image,
          }]
        : [],
    ),
  });
}

export const dynamic = "force-dynamic";
