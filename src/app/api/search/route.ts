import { NextResponse } from "next/server";
import { searchFighters, getUpcomingEvents, getResults, getArticles } from "@/lib/repo";
import { getCommunities } from "@/lib/community/repo";
import { getThreads } from "@/lib/forum/repo";
import { prisma } from "@/lib/db";
import { recommendVideos } from "@/lib/feed/recommend";
import { getCurrentUser } from "@/lib/auth";
import { PROMOTIONS } from "@/lib/promotions";
import { searchFollowState } from "@/lib/search-follow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Static destinations so search also jumps to sections/pages.
const PAGES = [
  { label: "Feed", href: "/" }, { label: "News", href: "/news" },
  { label: "Clips", href: "/clips" }, { label: "Community", href: "/community" },
  { label: "Forums", href: "/forums" }, { label: "Fighters", href: "/fighters" },
  { label: "Registry", href: "/registry" }, { label: "Rankings", href: "/rankings" },
  { label: "Pound for Pound", href: "/p4p" }, { label: "Champions", href: "/rankings" },
  { label: "Schedule", href: "/schedule" }, { label: "Results", href: "/results" },
  { label: "Predictions", href: "/predictions" }, { label: "Podcasts", href: "/podcasts" },
  { label: "Library", href: "/library" }, { label: "Profile", href: "/profile" },
  { label: "Account", href: "/account" },
];

// Site-wide search: fighters + events + gyms + people + news + communities +
// forum threads + pages.
//
// Gyms and people are searched in POSTGRES, not filtered in JS like the older
// sources above: those load a page of rows and match in memory, which is fine
// for a curated article list and wrong for user-generated tables that grow
// without bound.
//
// PEOPLE ARE NOT MAP-GATED HERE, and that is deliberate. `mapVisibility`
// governs appearing on a MAP — a coordinate. It is not a profile-privacy
// setting: /u/[username] is already a public page. Search therefore returns
// people who have chosen a public username, and nothing about where they are.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const empty = {
    fighters: [], events: [], gyms: [], people: [], promotions: [],
    articles: [], communities: [], threads: [], videos: [], pages: [],
    follow: null,
  };
  if (!q) return NextResponse.json(empty);

  const ql = q.toLowerCase();
  const has = (s?: string | null) => (s ?? "").toLowerCase().includes(ql);
  const contains = { contains: q, mode: "insensitive" as const };

  // The viewer, for follow state. Search stays fully functional signed out — a null
  // viewer just means every follow map comes back empty.
  const viewer = await getCurrentUser().catch(() => null);

  const [fighters, upcoming, results, articles, communities, threadsPage, gyms, people, videos] = await Promise.all([
    searchFighters(q).catch(() => []),
    getUpcomingEvents().catch(() => []),
    getResults().catch(() => []),
    getArticles().catch(() => []),
    getCommunities().catch(() => []),
    getThreads({ limit: 40 }).catch(() => ({ items: [], nextCursor: null })),
    prisma.gym
      .findMany({
        where: { OR: [{ name: contains }, { city: contains }] },
        orderBy: [{ verified: "desc" }, { memberCount: "desc" }],
        take: 6,
        select: {
          slug: true, name: true, city: true, country: true,
          verified: true, memberCount: true, disciplines: true,
        },
      })
      .catch(() => []),
    prisma.user
      .findMany({
        where: {
          username: { not: null },
          underageFlagged: false,
          OR: [{ username: contains }, { name: contains }],
        },
        orderBy: { reputation: "desc" },
        take: 6,
        select: { username: true, name: true, image: true, registryRole: true, reputation: true },
      })
      .catch(() => []),
    // Video results come from the SAME recommender every other surface uses, so
    // a search for a fighter ranks an interview above a generic promotion clip
    // by the same rules — not a second, subtly different matcher.
    recommendVideos({ text: q, fighterNames: [q], limit: 5 }).catch(() => []),
  ]);

  const events = [...upcoming, ...results]
    .filter((e) => has(e.name) || (e.city && has(e.city)) || e.fights?.some((f) => has(f.red?.name) || has(f.blue?.name)))
    .slice(0, 6)
    .map((e) => ({ slug: e.slug, name: e.name, city: e.city ?? null, status: e.status }));

  // PROMOTIONS are a followable entity with no table to search: the registry is a
  // static, curated list, so it is matched in memory. That is not the compromise it
  // would be for a user-generated table — there are a few dozen organisations and
  // the list ships with the bundle.
  const promotions = PROMOTIONS.filter((p) => has(p.name) || has(p.slug))
    .slice(0, 5)
    .map((p) => ({ slug: p.slug, name: p.name }));

  const topFighters = fighters.slice(0, 6);

  // ONE batched resolution for every family's follow state and follower counts —
  // never a query per row. See lib/search-follow: this route fires every 180ms as
  // somebody types.
  const follow = await searchFollowState(viewer?.id ?? null, {
    fighterSlugs: topFighters.map((f) => f.slug),
    eventSlugs: events.map((e) => e.slug),
    gymSlugs: gyms.map((g) => g.slug),
    promotionSlugs: promotions.map((p) => p.slug),
    usernames: people.flatMap((u) => (u.username ? [u.username] : [])),
  }).catch(() => null);

  return NextResponse.json({
    fighters: topFighters.map((f) => ({
      slug: f.slug, name: f.name, nickname: f.nickname ?? null,
      countryCode: f.countryCode ?? null, nationality: f.nationality ?? null,
      record: `${f.wins}-${f.losses}-${f.draws}`,
      // The fighter's own avatar, so a search row shows a face rather than a flag
      // alone. Already-processed variants only — never a hotlinked source URL.
      image: f.thumbUrl ?? f.imageUrl ?? null,
      verified: f.claimed ?? false,
    })),
    events,
    promotions,
    follow,
    gyms: gyms.map((g) => ({
      slug: g.slug, name: g.name,
      place: [g.city, g.country].filter(Boolean).join(", ") || null,
      verified: g.verified, memberCount: g.memberCount,
      disciplines: g.disciplines.slice(0, 3),
    })),
    people: people.flatMap((u) =>
      u.username
        ? [{ username: u.username, name: u.name, image: u.image, role: u.registryRole, reputation: u.reputation }]
        : [],
    ),
    articles: articles.filter((a) => has(a.title) || has(a.category)).slice(0, 6)
      .map((a) => ({ slug: a.slug, title: a.title, category: a.category })),
    communities: communities.filter((c) => has(c.name)).slice(0, 5)
      .map((c) => ({ slug: c.slug, name: c.name })),
    threads: (threadsPage.items ?? []).filter((t) => has(t.title) || has(t.categoryName)).slice(0, 5)
      .map((t) => ({ slug: t.slug, categorySlug: t.categorySlug, title: t.title, categoryName: t.categoryName })),
    videos: videos.map((v) => ({
      id: v.id, title: v.title, channel: v.channel,
      promotion: v.promotion, reason: v.reason,
    })),
    pages: PAGES.filter((p) => has(p.label)).slice(0, 5),
  });
}
