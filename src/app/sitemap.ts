import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";
import { listFighters, getArticles, getUpcomingEvents } from "@/lib/repo";
import { WEIGHT_CLASS_LIST } from "@/lib/repo";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/feature-flags";

/**
 * A disabled route must not be advertised to search engines.
 *
 * Rankings / P4P / Champions (unlicensed ranking data) and Predictions
 * (unlicensed market data) are withdrawn for the public launch. Listing them here
 * would invite crawlers to index an "unavailable" page and would keep the
 * withdrawn URLs alive in results.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url;
  const now = new Date();
  const f = flags();

  const staticRoutes = [
    "", "/fighters", "/events", "/schedule", "/home", "/results", "/registry",
    "/forums", "/search", "/account", "/news",
    // Legal surfaces — these SHOULD be indexable.
    "/privacy", "/terms", "/cookies", "/community-guidelines", "/copyright",
    "/data-sources", "/responsible-gambling",
    ...(f.rankingsEnabled ? ["/rankings", "/p4p", "/champions"] : []),
    ...(f.marketPricesEnabled ? ["/predictions"] : []),
  ].map((p) => ({
    url: `${base}${p}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: p === "" ? 1 : 0.8,
  }));

  const [fighters, articles, events, fights] = await Promise.all([
    listFighters(),
    getArticles(),
    getUpcomingEvents(),
    // Matchup pages. "X vs Y" is the highest-intent combat-sports search there
    // is, so every bout with an event gets an indexable URL — upcoming first,
    // then recent history, capped so the sitemap stays within spec limits.
    prisma.fight.findMany({
      where: { eventId: { not: null } },
      orderBy: { date: "desc" },
      take: 5000,
      select: { slug: true, date: true },
    }).catch(() => []),
  ]);

  return [
    ...staticRoutes,
    ...(f.rankingsEnabled
      ? WEIGHT_CLASS_LIST.map((w) => ({
          url: `${base}/rankings/${w.slug}`,
          lastModified: now,
          changeFrequency: "daily" as const,
          priority: 0.7,
        }))
      : []),
    ...fighters.map((x) => ({ url: `${base}/fighters/${x.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...articles.map((a) => ({ url: `${base}/news/${a.slug}`, lastModified: new Date(a.publishedAt), changeFrequency: "monthly" as const, priority: 0.5 })),
    ...events.map((e) => ({ url: `${base}/schedule/${e.slug}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.6 })),
    ...fights.map((x) => ({ url: `${base}/fights/${x.slug}`, lastModified: x.date, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
