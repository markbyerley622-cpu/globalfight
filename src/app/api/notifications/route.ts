import { NextResponse } from "next/server";
import { getArticles, getUpcomingEvents, getResults } from "@/lib/repo";
import { formatDate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type NotificationKind = "news" | "event" | "result";
export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  sub: string;
  href: string;
  ts: string;
};

// Composed from existing repo data (no separate notifications store): recent
// news, the soonest upcoming fights, and the latest results — the same
// source-backed feeds the ticker and News/Schedule pages use.
export async function GET() {
  const [articles, upcoming, results] = await Promise.all([
    getArticles(),
    getUpcomingEvents(),
    getResults(),
  ]);

  const news: Notification[] = articles.slice(0, 4).map((a) => ({
    id: `news:${a.id}`,
    kind: "news",
    title: a.title,
    sub: a.category,
    href: `/news/${a.slug}`,
    ts: a.publishedAt,
  }));

  const events: Notification[] = upcoming.slice(0, 3).map((e) => ({
    id: `event:${e.id}`,
    kind: "event",
    title: e.name,
    sub: [formatDate(e.date), e.city].filter(Boolean).join(" · "),
    href: `/schedule/${e.slug}`,
    ts: e.date,
  }));

  const latest: Notification[] = results.slice(0, 2).map((e) => {
    const main = e.fights.find((f) => f.mainEvent) ?? e.fights[0];
    return {
      id: `result:${e.id}`,
      kind: "result",
      title: main ? `${main.red.name} vs ${main.blue.name}` : e.name,
      sub: [e.name, main?.method].filter(Boolean).join(" · "),
      href: `/schedule/${e.slug}`,
      ts: e.date,
    };
  });

  // Curated order: freshest news, then latest results, then soonest upcoming.
  const notifications = [...news, ...latest, ...events];
  return NextResponse.json({ notifications, unread: notifications.length });
}
