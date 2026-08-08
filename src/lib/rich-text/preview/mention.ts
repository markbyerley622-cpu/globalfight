import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";
import { PRESENCE_SELECT } from "@/lib/presence/select";
import { presenceDtoFor } from "@/lib/presence/policy";
import { registerPreviewLoader } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A PERSON's preview.
//
//  ── Access-control walk (CLAUDE.md rules 1–8) ─────────────────────────────
//  Read-only. Every field below is already public on `/u/<handle>`, which is why
//  this loader does not require a session — refusing anonymous readers would
//  withhold what the profile page hands out freely, and the entity in the body
//  they are reading is public too.
//
//  Presence is the ONE field that is not unconditionally public, and it is not
//  filtered here: `presenceDtoFor` is the single privacy gate for it, and it
//  receives the viewer so someone who has switched presence off goes dark on
//  this surface for the same reason and by the same code as on every other
//  (rule 2 — the check lives in the shared layer, not at the call site).
//
//  Nothing is written, so rules 3–5 and 8 do not apply. Rule 6: an id that does
//  not resolve is simply absent from the result, identically to one that is
//  filtered — the endpoint cannot be used to test whether a user id exists.
// ════════════════════════════════════════════════════════════════════════════

registerPreviewLoader("mention", async (ids, ctx) => {
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      // `id` comes from PRESENCE_SELECT, which includes it on purpose so the
      // dto builder can recognise the viewer looking at their own row.
      username: true,
      name: true,
      image: true,
      reputation: true,
      professionalVerifiedAt: true,
      ...PRESENCE_SELECT,
      // Counts, not rows. `_count` is an aggregate in the same round trip;
      // selecting the relations would pull every follower of a popular account
      // into memory to produce one number.
      _count: { select: { followers: true, following: true } },
      // The home gym, if they have marked one. `take: 1` because the column is
      // a flag rather than a constraint, and a card has room for one.
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
    // Through publicDisplayName, never a raw User.name — the same rule the
    // rest of the product follows for anything a stranger can read.
    name: publicDisplayName(u),
    image: u.image,
    verified: u.professionalVerifiedAt !== null,
    reputation: u.reputation,
    followers: u._count.followers,
    following: u._count.following,
    presence: presenceDtoFor(u, ctx.viewerId),
    homeGym: u.gymMemberships[0]?.gym ?? null,
  }));
});
