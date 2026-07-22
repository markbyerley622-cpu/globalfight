import { NextResponse } from "next/server";
import { searchFighters, getUpcomingEvents, getResults, getArticles } from "@/lib/repo";
import { getCommunities } from "@/lib/community/repo";
import { getThreads } from "@/lib/forum/repo";
import { prisma } from "@/lib/db";

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
  const empty = { fighters: [], events: [], gyms: [], people: [], articles: [], communities: [], threads: [], pages: [] };
  if (!q) return NextResponse.json(empty);

  const ql = q.toLowerCase();
  const has = (s?: string | null) => (s ?? "").toLowerCase().includes(ql);
  const contains = { contains: q, mode: "insensitive" as const };

  const [fighters, upcoming, results, articles, communities, threadsPage, gyms, people] = await Promise.all([
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
  ]);

  const events = [...upcoming, ...results]
    .filter((e) => has(e.name) || (e.city && has(e.city)) || e.fights?.some((f) => has(f.red?.name) || has(f.blue?.name)))
    .slice(0, 6)
    .map((e) => ({ slug: e.slug, name: e.name, city: e.city ?? null, status: e.status }));

  return NextResponse.json({
    fighters: fighters.slice(0, 6).map((f) => ({
      slug: f.slug, name: f.name, nickname: f.nickname ?? null,
      countryCode: f.countryCode ?? null, nationality: f.nationality ?? null,
      record: `${f.wins}-${f.losses}-${f.draws}`,
    })),
    events,
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
    pages: PAGES.filter((p) => has(p.label)).slice(0, 5),
  });
}
