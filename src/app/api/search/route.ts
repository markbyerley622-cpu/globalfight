import { NextResponse } from "next/server";
import { searchFighters, getUpcomingEvents, getResults, getArticles } from "@/lib/repo";
import { getCommunities } from "@/lib/community/repo";
import { getThreads } from "@/lib/forum/repo";

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

// Site-wide search: fighters + events + news + communities + forum threads + pages.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const empty = { fighters: [], events: [], articles: [], communities: [], threads: [], pages: [] };
  if (!q) return NextResponse.json(empty);

  const ql = q.toLowerCase();
  const has = (s?: string | null) => (s ?? "").toLowerCase().includes(ql);

  const [fighters, upcoming, results, articles, communities, threadsPage] = await Promise.all([
    searchFighters(q).catch(() => []),
    getUpcomingEvents().catch(() => []),
    getResults().catch(() => []),
    getArticles().catch(() => []),
    getCommunities().catch(() => []),
    getThreads({ limit: 40 }).catch(() => ({ items: [], nextCursor: null })),
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
    articles: articles.filter((a) => has(a.title) || has(a.category)).slice(0, 6)
      .map((a) => ({ slug: a.slug, title: a.title, category: a.category })),
    communities: communities.filter((c) => has(c.name)).slice(0, 5)
      .map((c) => ({ slug: c.slug, name: c.name })),
    threads: (threadsPage.items ?? []).filter((t) => has(t.title) || has(t.categoryName)).slice(0, 5)
      .map((t) => ({ slug: t.slug, categorySlug: t.categorySlug, title: t.title, categoryName: t.categoryName })),
    pages: PAGES.filter((p) => has(p.label)).slice(0, 5),
  });
}
