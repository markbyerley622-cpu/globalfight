import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";
import { PRESENCE_SELECT } from "@/lib/presence/select";
import { presenceDtoFor } from "@/lib/presence/policy";
import { searchPeople } from "@/lib/users/search";
import { registerEntitySource } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A PERSON — suggest, resolve, hydrate, preview.
//
//  ── The key is the HANDLE, never the id ───────────────────────────────────
//  /api/users/search has always withheld primary keys — a typeahead open to any
//  signed-in user is the last surface that should hand them out — and that
//  decision survives here. The browser holds `alex`; the id is attached once,
//  server-side, by `resolve`.
//
//  ── Access-control walk (CLAUDE.md rules 1–8) ─────────────────────────────
//  `suggest` requires a viewer (its empty-query form returns the viewer's own
//  follows) and refuses to run without one. `resolve`, `hydrate` and `preview`
//  are public: every field is already on `/u/<handle>`. Presence is the one
//  non-public field and is filtered by presenceDtoFor, the single privacy gate,
//  rather than being re-decided here. Nothing writes. An id or handle that does
//  not resolve is ABSENT from the result, identically to one that is filtered,
//  so none of these is an existence oracle (rule 6).
// ════════════════════════════════════════════════════════════════════════════

registerEntitySource({
  kind: "mention",

  async suggest(q, limit, ctx) {
    // Signed-out readers get no people. Not a privacy line on the rows — they
    // are public — but the empty-query form is the viewer's own social graph,
    // and `searchPeople` is viewer-scoped by construction.
    if (!ctx.viewerId) return [];

    const rows = await searchPeople(q, ctx.viewerId, limit);
    return rows.flatMap((u) =>
      u.username
        ? [{
            kind: "mention",
            key: u.username,
            // A person inserts as their HANDLE — "@alex" is how people write
            // about each other, and it is what the legacy parser and every
            // historical body already contain.
            insert: u.username,
            title: publicDisplayName(u),
            subtitle: `@${u.username}`,
            imageUrl: u.image,
            verified: u.professionalVerifiedAt !== null,
          }]
        : [],
    );
  },

  async resolve(keys, _ctx) {
    const lowered = keys.map((k) => k.toLowerCase());
    const users = await prisma.user.findMany({
      where: { username: { in: lowered, mode: "insensitive" } },
      select: { id: true, username: true, name: true },
    });

    const out = new Map<string, { id: string; hint: { username: string; name: string }; expect: string }>();
    for (const u of users) {
      if (!u.username) continue;
      out.set(u.username.toLowerCase(), {
        id: u.id,
        // Stamped from the DATABASE, never from the request — otherwise a
        // client could write "@admin" as the display value over another id.
        hint: { username: u.username, name: publicDisplayName(u) },
        // The span must literally read "@handle".
        expect: `@${u.username}`,
      });
    }
    return out;
  },

  async hydrate(ids) {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, name: true },
    });
    const out = new Map<string, { username?: string; name?: string }>();
    for (const u of users) {
      // A user who has SHED their username has no public page. Omitting the
      // handle is what makes the renderer draw the words without a link,
      // rather than linking to /u/undefined.
      if (!u.username) continue;
      out.set(u.id, { username: u.username, name: publicDisplayName(u) });
    }
    return out;
  },

  async preview(ids, ctx) {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        username: true,
        name: true,
        image: true,
        reputation: true,
        professionalVerifiedAt: true,
        ...PRESENCE_SELECT,
        // Counts, not rows: selecting the relations would pull every follower
        // of a popular account into memory to produce one number.
        _count: { select: { followers: true, following: true } },
        gymMemberships: {
          where: { isHome: true },
          select: { gym: { select: { name: true, slug: true } } },
          take: 1,
        },
      },
    });

    return users.map((u) => ({
      kind: "mention",
      id: u.id,
      username: u.username,
      name: publicDisplayName(u),
      image: u.image,
      verified: u.professionalVerifiedAt !== null,
      reputation: u.reputation,
      followers: u._count.followers,
      following: u._count.following,
      presence: presenceDtoFor(u, ctx.viewerId),
      homeGym: u.gymMemberships[0]?.gym ?? null,
    }));
  },
});
