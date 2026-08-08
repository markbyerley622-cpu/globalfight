import "server-only";
import { prisma } from "@/lib/db";
import { SPORT_LABEL } from "@/lib/sports";
import { registerEntitySource } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A FIGHTER — a registry row, not an account.
//
//  ── The key is the SLUG ───────────────────────────────────────────────────
//  Already public: it is the URL at /fighters/<slug>. So it is safe for the
//  browser to hold and to send back, and the primary key never leaves the
//  server — the same invariant the mention source keeps with handles.
//
//  ── Access-control walk (CLAUDE.md rules 1–8) ─────────────────────────────
//  Every operation is a public read of a public directory; no session is
//  required and nothing here is viewer-scoped. Nothing writes. A slug or id
//  that does not resolve is absent from the result rather than an error.
// ════════════════════════════════════════════════════════════════════════════

/** Only ever project these — a typeahead has no business reading a whole row. */
const SUGGEST_SELECT = {
  slug: true, name: true, nickname: true, sport: true,
  thumbUrl: true, imageUrl: true, wins: true, losses: true, draws: true,
} as const;

/**
 * "12-3-1", or "12-3" when there are no draws.
 *
 * Built from the three counts rather than a stored string, so it cannot arrive
 * in one shape from ingest and another from a manual edit.
 */
function record(w: number, l: number, d: number): string {
  return d > 0 ? `${w}-${l}-${d}` : `${w}-${l}`;
}

/**
 * Rank a candidate list against what was typed.
 *
 * Exact → prefix → word-start → anything else, with the database's own order
 * (a stable name sort) preserved inside each band. Done in JS over a small
 * over-fetched window because Postgres has no cheap way to express it, and the
 * window is bounded — this is never a scan.
 */
function rankByMatch<T extends { name: string; nickname: string | null }>(
  rows: T[],
  q: string,
  limit: number,
): T[] {
  const ql = q.toLowerCase();
  const band = (r: T): number => {
    const name = r.name.toLowerCase();
    const nick = (r.nickname ?? "").toLowerCase();
    if (name === ql) return 0;
    if (name.startsWith(ql)) return 1;
    if (nick === ql || nick.startsWith(ql)) return 2;
    // A match at the start of any WORD — "pereira" finding "Alex Pereira" —
    // beats one buried mid-token, which is usually incidental.
    if (name.split(/\s+/).some((w) => w.startsWith(ql))) return 3;
    return 4;
  };
  return rows
    .map((r, i) => ({ r, i, b: band(r) }))
    .sort((x, y) => (x.b - y.b) || (x.i - y.i))
    .slice(0, limit)
    .map((x) => x.r);
}

registerEntitySource({
  kind: "fighter",

  async suggest(q, limit) {
    // No blind listing. A fighter picker with an empty query would be a
    // directory dump, and the directory is a page.
    if (!q) return [];

    const rows = await prisma.fighter.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { nickname: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      // Over-fetch a bounded window, then rank. See rankByMatch.
      take: limit * 4,
      select: SUGGEST_SELECT,
    });

    return rankByMatch(rows, q, limit).map((f) => ({
      kind: "fighter",
      key: f.slug,
      // A fighter inserts as their NAME. "@alex-pereira" is a URL, not
      // something anybody writes in a sentence.
      insert: f.name,
      title: f.name,
      // Only what exists. A missing nickname or an unknown record is omitted
      // rather than padded with a placeholder.
      subtitle: [
        f.nickname ? `“${f.nickname}”` : null,
        SPORT_LABEL[f.sport] ?? f.sport,
        record(f.wins, f.losses, f.draws),
      ].filter(Boolean).join(" · "),
      imageUrl: f.thumbUrl ?? f.imageUrl,
    }));
  },

  async resolve(keys) {
    const rows = await prisma.fighter.findMany({
      where: { slug: { in: keys } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(
      rows.map((f) => [
        f.slug,
        {
          id: f.id,
          hint: { slug: f.slug, name: f.name },
          // The span must read "@Name" — the text the picker inserted, stamped
          // from the database rather than taken from the request.
          expect: `@${f.name}`,
        },
      ]),
    );
  },

  async hydrate(ids) {
    const rows = await prisma.fighter.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(rows.map((f) => [f.id, { slug: f.slug, name: f.name }]));
  },

  async preview(ids) {
    const rows = await prisma.fighter.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, slug: true, name: true, nickname: true, sport: true,
        imageUrl: true, wins: true, losses: true, draws: true,
      },
    });
    return rows.map((f) => ({
      kind: "fighter",
      id: f.id,
      slug: f.slug,
      name: f.name,
      nickname: f.nickname,
      sport: SPORT_LABEL[f.sport] ?? f.sport,
      imageUrl: f.imageUrl,
      wins: f.wins,
      losses: f.losses,
      draws: f.draws,
    }));
  },
});
