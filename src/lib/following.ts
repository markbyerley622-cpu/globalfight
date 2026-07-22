import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug, promotionSearchTerms } from "@/lib/promotions";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { brandedHero } from "@/lib/placeholder";
import { safeNewsCover } from "@/lib/media-safe";
import { resolvePromotion } from "@/lib/promotions";
import { formatSportRecord } from "@/lib/sports";
import { safeFighterImageOrNull } from "@/lib/media-safe";
import { SPORTS } from "@/lib/sports";
import { recommendVideos } from "@/lib/feed/recommend";

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
  | "fighter"          // a fighter you follow — booking, record, standing
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
  /** Present only on kind === "fighter". Everything the card shows, resolved
   *  server-side and batch-loaded — never one query per card. */
  fighter?: {
    slug: string;
    name: string;
    nickname: string | null;
    /** Formatted for the fighter's own sport (wld / belt / rank …). */
    record: string;
    koWins: number;
    /** A licensed photo, or null — the card draws branded artwork instead.
     *  Only 84 of 2,124 fighters have one, so null is the COMMON case. */
    photo: string | null;
    sportSlug: string | null;
    countryCode: string | null;
    /** Null for everyone today (the Ranking table is empty) — the card omits
     *  the line entirely rather than rendering an empty label. */
    rank: { rank: number; weightClass: string } | null;
    /** Null when nothing is booked — the card says so rather than leaving a gap. */
    next: {
      opponent: string; date: string; eventName: string | null;
      promotionName: string | null; accent: string | null; url: string;
      titleFight: boolean;
    } | null;
    /** Whether fight alerts will actually reach them, so the card can state it
     *  truthfully instead of implying it. */
    notifications: boolean;
  };
  /** Everything the card needs to be IMAGE-FIRST. Resolved server-side so a
   *  card never has to decide between a real image and generated art at render
   *  time (and never flashes from one to the other). */
  media?: {
    /** Always set. A licensed publisher image where one exists, otherwise our
     *  own branded artwork — never blank, never an emoji. */
    image: string;
    /** True when `image` is generated, so the card can skip the watermark
     *  overlay (the artwork already carries the wordmark). */
    generated: boolean;
    /** Promotion brand colour, for accents. */
    accent?: string | null;
    promotionSlug?: string | null;
    promotionName?: string | null;
    /** Secondary line under the headline: source, venue, channel. */
    source?: string | null;
  };
}

// A user's sportPrefs ARE their discipline follows — the same values the
// onboarding writes and the ?sport= pills read. There is deliberately no
// "video preferences" anywhere: following Boxing is the whole opt-in.
const DISCIPLINE_SLUG: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.value, s.slug]),
);


const iso = (d: Date) => d.toISOString();

/** Image-first media for an event card: its poster when one exists, otherwise
 *  branded artwork in the promotion's own colour. Resolved here so the card
 *  never has to choose at render time. */
function eventMedia(e: {
  slug: string; promotion: string | null; posterUrl?: string | null; sport?: string | null;
}) {
  const promo = resolvePromotion(e.promotion);
  const sportSlug = e.sport ? String(e.sport).toLowerCase().replace(/_/g, "-") : null;
  return {
    image: e.posterUrl || brandedHero(e.slug, promo.brand, sportSlug),
    generated: !e.posterUrl,
    accent: promo.brand,
    promotionSlug: promo.slug,
    promotionName: promo.name,
    source: e.promotion ?? promo.name,
  };
}

/** What this user follows. Three cheap indexed reads. */
async function getFollowGraph(userId: string) {
  const [events, fighters, promotions, me] = await Promise.all([
    prisma.favoriteEvent.findMany({ where: { userId }, select: { eventId: true } }),
    prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } }),
    prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { sportPrefs: true, notifyFights: true } }),
  ]);
  return {
    eventIds: events.map((e) => e.eventId),
    fighterIds: fighters.map((f) => f.fighterId),
    promotions: promotions.map((p) => p.promotion),
    disciplines: [...new Set((me?.sportPrefs ?? []).map((v) => DISCIPLINE_SLUG[v]).filter(Boolean))],
    // Read from the profile the graph already loads, so the card can say
    // "Alerts on" truthfully rather than implying it.
    notifyFights: me?.notifyFights ?? false,
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
  const { eventIds, fighterIds, promotions, disciplines, notifyFights } = await getFollowGraph(userId);
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
  // ONE query for the fighters themselves and ONE for their rankings — both
  // keyed by the whole follow list, never per card. A feed with fifty followed
  // fighters costs exactly the same two reads as one.
  const [followedFighters, rankings] = fighterIds.length
    ? await Promise.all([
        prisma.fighter.findMany({
          where: { id: { in: fighterIds } },
          select: {
            id: true, slug: true, name: true, nickname: true, sport: true,
            wins: true, losses: true, draws: true, noContests: true, koWins: true,
            photoUrl: true, imageUrl: true, thumbUrl: true, countryCode: true,
          },
        }),
        prisma.ranking.findMany({
          where: { fighterId: { in: fighterIds }, isPoundForPound: false },
          orderBy: { rank: "asc" },
          select: { fighterId: true, rank: true, weightClass: { select: { name: true } } },
        }),
      ])
    : [[], []];
  const fighterNames = followedFighters.map((f) => f.name).filter((n) => n && n.length >= 6);

  const [upcomingEvents, results, fighterFights, personal, coverage] = await Promise.all([
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
          select: { id: true, slug: true, name: true, date: true, promotion: true, venue: true, city: true, posterUrl: true, sport: true, _count: { select: { fights: true } } },
        })
      : Promise.resolve([]),

    // Results from cards you followed.
    eventIds.length
      ? prisma.event.findMany({
          where: { ...PUBLIC_EVENT, id: { in: eventIds }, date: { gte: recently, lt: now } },
          orderBy: { date: "desc" },
          take: 15,
          select: { id: true, slug: true, name: true, date: true, promotion: true, posterUrl: true, sport: true, _count: { select: { fights: true } } },
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
            event: { select: { slug: true, name: true, promotion: true } },
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
          select: { id: true, slug: true, title: true, publishedAt: true, coverImageUrl: true, category: true, author: { select: { name: true } } },
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
      media: eventMedia(e),
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
      media: eventMedia(e),
    });
  }

  // ── Fighter cards ────────────────────────────────────────────────────────
  // A followed fighter is a first-class feed entity, not a text row about a
  // booking. The booking is folded INTO the card (its "Next fight" block)
  // rather than emitted separately — two items about the same event is exactly
  // the duplication the redesign is removing.
  const rankByFighter = new Map(rankings.map((r) => [r.fighterId, r]));
  const nextByFighter = new Map<string, (typeof fighterFights)[number]>();
  for (const f of fighterFights) {
    for (const side of [f.red, f.blue]) {
      if (!fighterIds.includes(side.id)) continue;
      // fighterFights is ordered by date ascending, so the first hit is next.
      if (!nextByFighter.has(side.id)) nextByFighter.set(side.id, f);
    }
  }

  // Booked fighters first — a card with a date on it is worth more than a
  // standing one — then cap, so following thirty people cannot bury the feed.
  const fighterCards = [...followedFighters]
    .sort((a, b) => (nextByFighter.has(b.id) ? 1 : 0) - (nextByFighter.has(a.id) ? 1 : 0))
    .slice(0, 8);

  for (const fr of fighterCards) {
    const nf = nextByFighter.get(fr.id);
    const opponent = nf ? (nf.red.id === fr.id ? nf.blue : nf.red) : null;
    const promo = nf?.event ? resolvePromotion(nf.event.promotion ?? null) : null;
    const rk = rankByFighter.get(fr.id);

    items.push({
      id: `fr-${fr.id}`,
      kind: "fighter",
      // A booked fighter sorts by how soon they fight; an unbooked one sits at
      // the point they were followed rather than claiming the top of the feed.
      at: nf ? iso(new Date(now.getTime() + Math.max(0, nf.date.getTime() - now.getTime()) / 1000 + 1)) : iso(recently),
      title: fr.name,
      body: null,
      url: `/fighters/${fr.slug}`,
      icon: "🥊",
      meta: nf ? whenLabel(nf.date) : null,
      fighter: {
        slug: fr.slug,
        name: fr.name,
        nickname: fr.nickname ?? null,
        record: formatSportRecord({
          sport: fr.sport, wins: fr.wins, losses: fr.losses,
          draws: fr.draws, noContests: fr.noContests ?? 0,
        }),
        koWins: fr.koWins ?? 0,
        photo: safeFighterImageOrNull(fr.photoUrl ?? fr.imageUrl ?? fr.thumbUrl),
        sportSlug: String(fr.sport).toLowerCase().replace(/_/g, "-"),
        countryCode: fr.countryCode ?? null,
        rank: rk ? { rank: rk.rank, weightClass: rk.weightClass.name } : null,
        next: nf && opponent
          ? {
              opponent: opponent.name,
              date: iso(nf.date),
              eventName: nf.event?.name ?? null,
              promotionName: promo?.name ?? null,
              accent: promo?.brand ?? null,
              url: `/fights/${nf.slug}`,
              titleFight: !!nf.titleFight,
            }
          : null,
        notifications: notifyFights,
      },
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
      media: {
        // safeNewsCover keeps the deliberate legal line: a publisher image is
        // used only when it is licensed syndication, otherwise we draw our own
        // rather than hotlinking someone's server.
        image: safeNewsCover(a.slug, a.coverImageUrl) || brandedHero(a.slug, null, null),
        generated: !a.coverImageUrl,
        source: a.author?.name ?? "News",
      },
    });
  }

  // Video comes from the SHARED recommender — same query, same tiering, same
  // mute handling as the fighter page, the event page and search. This used to
  // be a second FeedVideo query with its own copy of the priority rules, which
  // is exactly the duplication that lets two surfaces disagree about what
  // "relevant" means.
  const recs = (promotions.length || disciplines.length || fighterNames.length)
    ? await recommendVideos({
        promotions, disciplines, fighterNames,
        viewerId: userId, preferUnseen: true, voice: "following", limit: 8,
      })
    : [];

  const videoItems: FeedItem[] = recs.map((v) => ({
    id: `vd-${v.id}`,
    kind: "video",
    at: v.publishedAt ?? iso(now),
    title: v.title,
    body: null,
    url: `/clips${v.promotion ? `?promotion=${v.promotion}` : ""}`,
    icon: "▶️",
    meta: null,
    reason: v.reason,
    video: { channel: v.channel, promotion: v.promotion, promotionName: v.promotionName },
  }));

  const ranked = items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return interleaveVideos(ranked, videoItems, limit);
}

/**
 * Fold video in, then break up runs of the same kind.
 *
 * Recency alone produced exactly the failure the redesign is about: the news
 * pipeline publishes hundreds of items a day and events cluster on fight week,
 * so a pure timeline gave ten articles in a row and called it a feed. That is
 * a database listing with an ORDER BY, not something worth opening twice a day.
 *
 * Two rules, in order:
 *   1. video enters on a fixed interval, so it seasons rather than dominates
 *   2. no more than MAX_RUN of any one kind consecutively — when the next item
 *      would break that, the highest-ranked item of a DIFFERENT kind is pulled
 *      forward instead
 *
 * Rule 2 never drops anything and never reorders across kinds beyond the
 * minimum needed: an item deferred for variety is the very next one placed once
 * the run is broken, so "most recent first" still holds within each kind.
 */
const VIDEO_EVERY = 9; // one per 9 items — inside the 8–10 the product asked for
const MAX_RUN = 2;     // two of a kind is a pair; three is a wall

/**
 * Visual families, not FeedKinds.
 *
 * A reader does not distinguish an upcoming card from a result from a booked
 * bout — those are three kinds but one look, and three of them in a row reads
 * as "four events in a row" no matter what the enum says. The run rule has to
 * work on what the eye groups, which is coarser than the data model.
 */
const FAMILY: Record<FeedKind, string> = {
  event_upcoming: "event",
  fighter: "fighter",
  result: "event",
  coverage: "news",
  video: "video",
  personal: "personal",
};

function interleaveVideos(ranked: FeedItem[], videoItems: FeedItem[], limit: number): FeedItem[] {
  const queue = videoItems;
  const pending = [...ranked];
  const out: FeedItem[] = [];
  let vi = 0;
  let lastFamily: string | null = null;
  let run = 0;

  while (out.length < limit && (pending.length || vi < queue.length)) {
    // Video first when the interval says so — it is the strongest visual break.
    if (out.length && out.length % VIDEO_EVERY === 0 && vi < queue.length) {
      out.push(queue[vi++]);
      lastFamily = "video";
      run = 1;
      continue;
    }
    if (!pending.length) {
      // The timeline is exhausted. Videos may still be queued, but flushing
      // them here is what produced a tail of five videos in a row: the feed
      // ended in a block of the one family the density rule exists to limit.
      // A video may only follow a non-video, so the tail stays mixed or stops.
      if (vi < queue.length && lastFamily !== "video") {
        out.push(queue[vi++]);
        lastFamily = "video";
        run = 1;
        continue;
      }
      break;
    }

    // Prefer the next item, unless it would extend a run past MAX_RUN.
    let idx = 0;
    if (lastFamily && run >= MAX_RUN) {
      // Pull the highest-ranked item of a DIFFERENT family forward. If the pool
      // holds nothing else — a user who follows only events genuinely has an
      // event-only feed — the run continues rather than the feed going short.
      const alt = pending.findIndex((it) => FAMILY[it.kind] !== lastFamily);
      if (alt !== -1) idx = alt;
    }
    const [item] = pending.splice(idx, 1);
    const family = FAMILY[item.kind];
    run = family === lastFamily ? run + 1 : 1;
    lastFamily = family;
    out.push(item);
  }

  // A sparse feed still shows a video rather than dropping it — but ONE, and
  // only if the feed does not already end on one.
  if (out.length < VIDEO_EVERY && vi < queue.length && lastFamily !== "video") {
    out.push(queue[vi]);
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
