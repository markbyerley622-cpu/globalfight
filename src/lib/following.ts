import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug, promotionSearchTerms } from "@/lib/promotions";

// ════════════════════════════════════════════════════════════════════════════
//  The Following feed — the return leg of the loop.
//
//  Everything else in Phase 1 brings a user IN. This is the only surface whose
//  job is bringing them BACK, so it is deliberately narrow: it contains nothing
//  a user did not ask for by following an event, a fighter or a promotion, plus
//  the things that happened to them personally (battle results, replies).
//
//  It is NOT a generic social feed. Every item links to a fight, an event, a
//  fighter or a room. If an item can't do that, it doesn't belong here.
//
//  Cost: a fixed set of batched queries regardless of how much a user follows —
//  never one query per followed thing.
// ════════════════════════════════════════════════════════════════════════════

export type FeedKind =
  | "event_upcoming"   // a card you follow is coming
  | "fight_upcoming"   // a fighter you follow is booked
  | "result"           // a card you follow finished
  | "personal"         // battle result, reply, mention — already user-targeted
  | "coverage";        // news naming a fighter/promotion you follow

export interface FeedItem {
  id: string;
  kind: FeedKind;
  /** Sort key — newest first across every source. */
  at: string;
  title: string;
  body?: string | null;
  url: string;
  icon?: string | null;
  /** Small context line: promotion, venue, "in 3 days". */
  meta?: string | null;
}


const iso = (d: Date) => d.toISOString();

/** What this user follows. Three cheap indexed reads. */
async function getFollowGraph(userId: string) {
  const [events, fighters, promotions] = await Promise.all([
    prisma.favoriteEvent.findMany({ where: { userId }, select: { eventId: true } }),
    prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } }),
    prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } }),
  ]);
  return {
    eventIds: events.map((e) => e.eventId),
    fighterIds: fighters.map((f) => f.fighterId),
    promotions: promotions.map((p) => p.promotion),
  };
}

/**
 * The feed. Unions a fixed set of batched queries and sorts newest-first.
 *
 * "Newest first" means most RECENTLY RELEVANT: an upcoming card sorts by how
 * soon it is, a result by when it happened. Both compete on one timeline, which
 * is how a fan actually experiences fight week.
 */
export async function getFollowingFeed(userId: string, limit = 40): Promise<FeedItem[]> {
  const { eventIds, fighterIds, promotions } = await getFollowGraph(userId);
  const now = new Date();
  const soon = new Date(now.getTime() + 45 * 86_400_000);
  const recently = new Date(now.getTime() - 21 * 86_400_000);

  const followsSomething = eventIds.length > 0 || fighterIds.length > 0 || promotions.length > 0;

  // Curated, specific phrases for the promotions this user follows. Short or
  // ambiguous aliases are dropped — a 4-character term in a `contains` match is
  // a false-positive generator, not a filter.
  const coverageTerms = [
    ...new Set(
      promotions.flatMap((slug) => promotionBySlug(slug)?.aliases ?? []).filter((a) => a.length >= 5),
    ),
  ];

  const [upcomingEvents, results, fighterFights, personal, coverage] = await Promise.all([
    // Cards you follow directly, or run by a promotion you follow.
    followsSomething
      ? prisma.event.findMany({
          where: {
            date: { gte: now, lte: soon },
            OR: [
              ...(eventIds.length ? [{ id: { in: eventIds } }] : []),
              // Event.promotion is FREE TEXT; a follow is a registry slug.
              // `promotion IN ('one')` matched nothing, so "cards run by a
              // promotion you follow" silently never appeared in the feed.
              ...promotionSearchTerms(promotions).map((t) => ({ promotion: { contains: t, mode: "insensitive" as const } })),
            ],
          },
          orderBy: { date: "asc" },
          take: 20,
          select: { id: true, slug: true, name: true, date: true, promotion: true, venue: true, city: true, _count: { select: { fights: true } } },
        })
      : Promise.resolve([]),

    // Results from cards you followed.
    eventIds.length
      ? prisma.event.findMany({
          where: { id: { in: eventIds }, date: { gte: recently, lt: now } },
          orderBy: { date: "desc" },
          take: 15,
          select: { id: true, slug: true, name: true, date: true, promotion: true, _count: { select: { fights: true } } },
        })
      : Promise.resolve([]),

    // Fighters you follow, booked on an upcoming card.
    fighterIds.length
      ? prisma.fight.findMany({
          where: {
            date: { gte: now, lte: soon },
            OR: [{ redId: { in: fighterIds } }, { blueId: { in: fighterIds } }],
          },
          orderBy: { date: "asc" },
          take: 20,
          select: {
            id: true, slug: true, date: true, titleFight: true,
            red: { select: { id: true, name: true } },
            blue: { select: { id: true, name: true } },
            event: { select: { slug: true, name: true } },
          },
        })
      : Promise.resolve([]),

    // Already-personal items: battle results, battle replies, pick results.
    // These are user-targeted by construction, so no follow graph is needed.
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, type: true, title: true, body: true, url: true, icon: true, createdAt: true },
    }),

    // Coverage naming a promotion you follow.
    //
    // Matched on the registry's curated ALIASES, never the slug. A slug is a
    // short token and `contains` is a substring test, so following "one" matched
    // "sees only one winner", "one more round", "On To the Next One" — mostly
    // noise. The alias list is specific by design ("one championship", "one
    // friday fights") and deliberately omits bare "one" for this exact reason.
    //
    // Fighter-name matching stays out: a surname LIKE across the whole article
    // table looks fine on a laptop and falls over on a real news corpus.
    coverageTerms.length
      ? prisma.article.findMany({
          where: { status: "PUBLISHED", publishedAt: { gte: recently }, OR: coverageTerms.map((t) => ({ title: { contains: t, mode: "insensitive" as const } })) },
          orderBy: { publishedAt: "desc" },
          take: 10,
          // publishedAt is nullable on the model; the WHERE above guarantees a
          // value, but the type doesn't, so it's narrowed at the mapping site.
          select: { id: true, slug: true, title: true, publishedAt: true, author: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const items: FeedItem[] = [];
  const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86_400_000);
  const whenLabel = (d: Date) => {
    const n = days(d);
    if (n <= 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n <= 7) return `In ${n} days`;
    return `In ${Math.round(n / 7)} weeks`;
  };

  for (const e of upcomingEvents) {
    items.push({
      id: `ev-${e.id}`,
      kind: "event_upcoming",
      // Sort an upcoming card by imminence: the closer it is, the higher it sits.
      at: iso(new Date(now.getTime() + Math.max(0, e.date.getTime() - now.getTime()) / 1000)),
      title: e.name,
      body: `${e._count.fights} bout${e._count.fights === 1 ? "" : "s"}${e.venue ? ` · ${e.venue}` : ""}`,
      url: `/events/${e.slug}`,
      icon: "📅",
      meta: [whenLabel(e.date), e.city].filter(Boolean).join(" · "),
    });
  }

  for (const e of results) {
    items.push({
      id: `res-${e.id}`,
      kind: "result",
      at: iso(e.date),
      title: `${e.name} — results`,
      body: `${e._count.fights} bout${e._count.fights === 1 ? "" : "s"} settled. See how your picks landed.`,
      url: `/events/${e.slug}`,
      icon: "🏁",
      meta: e.promotion ?? null,
    });
  }

  for (const f of fighterFights) {
    const followed = fighterIds.includes(f.red.id) ? f.red : f.blue;
    const opponent = followed.id === f.red.id ? f.blue : f.red;
    items.push({
      id: `ft-${f.id}`,
      kind: "fight_upcoming",
      at: iso(new Date(now.getTime() + Math.max(0, f.date.getTime() - now.getTime()) / 1000 + 1)),
      title: `${followed.name} vs ${opponent.name}`,
      body: f.event ? `${f.event.name}${f.titleFight ? " · Title fight" : ""}` : null,
      url: `/fights/${f.slug}`,
      icon: "🥊",
      meta: whenLabel(f.date),
    });
  }

  for (const n of personal) {
    items.push({
      id: `nt-${n.id}`,
      kind: "personal",
      at: iso(n.createdAt),
      title: n.title,
      body: n.body,
      url: n.url ?? "/",
      icon: n.icon,
      meta: null,
    });
  }

  for (const a of coverage) {
    if (!a.publishedAt) continue; // unpublished has no place on a timeline
    items.push({
      id: `ar-${a.id}`,
      kind: "coverage",
      at: iso(a.publishedAt),
      title: a.title,
      body: null,
      url: `/news/${a.slug}`,
      icon: "📰",
      meta: a.author?.name ?? null,
    });
  }

  return items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, limit);
}

/** Counts for the empty/summary state. */
export async function getFollowingSummary(userId: string): Promise<{ events: number; fighters: number; promotions: number; total: number }> {
  const [events, fighters, promotions] = await Promise.all([
    prisma.favoriteEvent.count({ where: { userId } }),
    prisma.favoriteFighter.count({ where: { userId } }),
    prisma.favoritePromotion.count({ where: { userId } }),
  ]);
  return { events, fighters, promotions, total: events + fighters + promotions };
}
