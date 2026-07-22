import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug, promotionSearchTerms } from "@/lib/promotions";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { SPORTS } from "@/lib/sports";

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
  | "coverage"         // news naming a fighter/promotion you follow
  | "video";           // an upload from a channel your follows map to

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
  /** Why this is on YOUR feed — "Because you follow UFC". Only set for items
   *  that are recommended rather than directly subscribed, because a card you
   *  explicitly followed does not need explaining. */
  reason?: string | null;
  /** Present only on kind === "video": what the card needs to render a player
   *  without a second round trip. */
  video?: { channel: string; promotion: string | null; promotionName: string | null };
}

// A user's sportPrefs ARE their discipline follows — the same values the
// onboarding writes and the ?sport= pills read. There is deliberately no
// "video preferences" anywhere: following Boxing is the whole opt-in.
const DISCIPLINE_SLUG: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.value, s.slug]),
);


const iso = (d: Date) => d.toISOString();

/** What this user follows. Three cheap indexed reads. */
async function getFollowGraph(userId: string) {
  const [events, fighters, promotions, me] = await Promise.all([
    prisma.favoriteEvent.findMany({ where: { userId }, select: { eventId: true } }),
    prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } }),
    prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { sportPrefs: true } }),
  ]);
  return {
    eventIds: events.map((e) => e.eventId),
    fighterIds: fighters.map((f) => f.fighterId),
    promotions: promotions.map((p) => p.promotion),
    disciplines: [...new Set((me?.sportPrefs ?? []).map((v) => DISCIPLINE_SLUG[v]).filter(Boolean))],
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
  const { eventIds, fighterIds, promotions, disciplines } = await getFollowGraph(userId);
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

  // Fighters you follow, by name — used to spot an interview or a preview that
  // actually names them. Full names only: a surname `contains` across a video
  // catalog is a false-positive generator, exactly as it is for articles.
  const followedFighters = fighterIds.length
    ? await prisma.fighter.findMany({
        where: { id: { in: fighterIds } },
        select: { id: true, name: true },
      })
    : [];
  const fighterNames = followedFighters.map((f) => f.name).filter((n) => n && n.length >= 6);

  const [upcomingEvents, results, fighterFights, personal, coverage, videos, suppressed] = await Promise.all([
    // Cards you follow directly, or run by a promotion you follow.
    followsSomething
      ? prisma.event.findMany({
          where: {
            ...PUBLIC_EVENT,
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
          where: { ...PUBLIC_EVENT, id: { in: eventIds }, date: { gte: recently, lt: now } },
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

    // ── Video ────────────────────────────────────────────────────────────
    // ONE query for every reason a video could be relevant, OR'd together and
    // index-backed on (promotion, publishedAt) / (discipline, publishedAt).
    // Never one query per followed thing, and never a query per rendered card.
    (promotions.length || disciplines.length || fighterNames.length)
      ? prisma.feedVideo.findMany({
          where: {
            publishedAt: { gte: recently },
            OR: [
              ...(promotions.length ? [{ promotion: { in: promotions } }] : []),
              ...(disciplines.length ? [{ discipline: { in: disciplines } }] : []),
              ...fighterNames.map((n) => ({ title: { contains: n, mode: "insensitive" as const } })),
            ],
          },
          orderBy: { publishedAt: "desc" },
          take: 30,
          select: {
            id: true, title: true, channel: true, channelId: true,
            publishedAt: true, promotion: true, discipline: true,
          },
        })
      : Promise.resolve([]),

    // What this user has already seen or muted. Reuses the feed's existing
    // per-user state tables rather than inventing a second seen/hidden store —
    // keyed by user id, the same key /api/feed uses when signed in.
    Promise.all([
      prisma.feedView.findMany({ where: { key: userId }, select: { videoId: true } }),
      prisma.feedNotInterested.findMany({ where: { key: userId }, select: { videoId: true } }),
      prisma.feedHiddenChannel.findMany({ where: { key: userId }, select: { channelId: true } }),
    ]),
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

  // ── Video items ──────────────────────────────────────────────────────────
  const [seenRows, notInterested, hiddenChannels] = suppressed;
  const seen = new Set(seenRows.map((r) => r.videoId));
  const muted = new Set(notInterested.map((r) => r.videoId));
  const mutedChannels = new Set(hiddenChannels.map((r) => r.channelId));

  const videoItems: FeedItem[] = [];
  for (const v of videos) {
    if (!v.publishedAt) continue;
    if (muted.has(v.id)) continue;                                  // "not interested"
    if (v.channelId && mutedChannels.has(v.channelId)) continue;     // muted channel

    // Every video must be able to say why it is here. Most specific wins: a
    // named fighter beats the promotion, which beats the discipline. If none of
    // them apply the video is dropped rather than shown unexplained — that is
    // the difference between a recommendation and noise.
    const named = fighterNames.find((n) => v.title.toLowerCase().includes(n.toLowerCase()));
    const promoName = v.promotion ? promotionBySlug(v.promotion)?.name ?? null : null;
    let reason: string | null = null;
    if (named) reason = `Because you follow ${named}`;
    else if (v.promotion && promotions.includes(v.promotion)) reason = `Following ${promoName ?? v.promotion}`;
    else if (v.discipline && disciplines.includes(v.discipline)) {
      reason = `Recommended from ${SPORTS.find((sp) => sp.slug === v.discipline)?.label ?? v.discipline}`;
    }
    if (!reason) continue;

    videoItems.push({
      id: `vd-${v.id}`,
      kind: "video",
      at: iso(v.publishedAt),
      title: v.title,
      body: null,
      url: `/clips${v.promotion ? `?promotion=${v.promotion}` : ""}`,
      icon: "▶️",
      meta: null,
      reason,
      video: { channel: v.channel, promotion: v.promotion, promotionName: promoName },
      // Already-watched sinks rather than disappearing: a video you started and
      // left is still a reasonable thing to find again, just not at the top.
      ...(seen.has(v.id) ? { seen: true } : {}),
    } as FeedItem & { seen?: boolean });
  }

  const ranked = items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return interleaveVideos(ranked, videoItems, limit);
}

/**
 * Fold video into the ranked timeline at a fixed maximum density.
 *
 * Videos publish in bursts — a promotion drops six clips on fight-week Friday —
 * so competing purely on recency would hand a whole screen to one channel and
 * bury the articles and discussions the feed exists for. Articles and
 * discussions stay primary; video is seasoning.
 *
 * One video per VIDEO_EVERY items, newest first, and never two in a row by
 * construction because a video is only emitted on the interval boundary.
 */
const VIDEO_EVERY = 9; // one per 9 items — inside the 8–10 the product asked for

function interleaveVideos(ranked: FeedItem[], videoItems: FeedItem[], limit: number): FeedItem[] {
  if (!videoItems.length) return ranked.slice(0, limit);

  // Unseen first, then newest — so a burst of six shows its best one.
  const queue = [...videoItems].sort((a, b) => {
    const sa = (a as FeedItem & { seen?: boolean }).seen ? 1 : 0;
    const sb = (b as FeedItem & { seen?: boolean }).seen ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return a.at < b.at ? 1 : -1;
  });

  const out: FeedItem[] = [];
  let vi = 0;
  for (const item of ranked) {
    out.push(item);
    if (out.length >= limit) break;
    // Boundary, and only once the feed has enough substance to season.
    if (out.length % VIDEO_EVERY === 0 && vi < queue.length) {
      out.push(queue[vi++]);
    }
  }

  // A feed with almost nothing else in it still shows its videos rather than
  // dropping them — but at most a couple, so it never becomes a video page.
  if (out.length < VIDEO_EVERY && vi < queue.length) {
    out.push(...queue.slice(vi, vi + 2));
  }
  return out.slice(0, limit);
}

// ── Rivals ──────────────────────────────────────────────────────────────────
// The concept's "Friends" tab. There is no user→user follow graph in this
// schema and inventing one for a tab would be the wrong order of work — but
// Rivalry already records exactly who you actually engage with: everyone you
// have taken a Prediction Battle against, and the head-to-head record.

export interface Rival {
  userId: string;
  name: string | null;
  username: string | null;
  image: string | null;
  /** Head-to-head from the VIEWER's side. */
  wins: number;
  losses: number;
  draws: number;
  /** Positive: you're on a run. Negative: they are. */
  streak: number;
  lastBattleAt: string;
}

export async function getRivals(userId: string, limit = 20): Promise<Rival[]> {
  const rows = await prisma.rivalry.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: { lastBattleAt: "desc" },
    take: limit,
    select: {
      userAId: true, userBId: true, aWins: true, bWins: true, draws: true,
      currentStreakUserId: true, currentStreak: true, lastBattleAt: true,
      userA: { select: { id: true, name: true, username: true, image: true } },
      userB: { select: { id: true, name: true, username: true, image: true } },
    },
  });

  return rows.map((r) => {
    const viewerIsA = r.userAId === userId;
    const them = viewerIsA ? r.userB : r.userA;
    const streakIsMine = r.currentStreakUserId === userId;
    return {
      userId: them.id,
      name: them.name,
      username: them.username,
      image: them.image,
      wins: viewerIsA ? r.aWins : r.bWins,
      losses: viewerIsA ? r.bWins : r.aWins,
      draws: r.draws,
      streak: r.currentStreak === 0 ? 0 : streakIsMine ? r.currentStreak : -r.currentStreak,
      lastBattleAt: iso(r.lastBattleAt),
    };
  });
}

// ── Corner Men ──────────────────────────────────────────────────────────────
/** Recent published analysis — the creator side of the Following pillar. */
export async function getCornerMen(limit = 12): Promise<FeedItem[]> {
  const rows = await prisma.article.findMany({
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: {
      id: true, slug: true, title: true, excerpt: true, publishedAt: true,
      author: { select: { name: true, username: true } },
    },
  });

  return rows.flatMap((a) =>
    a.publishedAt
      ? [{
          id: `cm-${a.id}`,
          kind: "coverage" as const,
          at: iso(a.publishedAt),
          title: a.title,
          body: a.excerpt,
          url: `/news/${a.slug}`,
          icon: "🎙️",
          meta: a.author?.name ?? a.author?.username ?? "Combat Reviews",
        }]
      : [],
  );
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
