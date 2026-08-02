import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug, promotionSearchTerms } from "@/lib/promotions";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { brandedHero } from "@/lib/placeholder";
import { safeNewsCover } from "@/lib/media-safe";

/** "none" is the OG-enrichment sentinel for "checked, no image" — treat as absent. */
const ogImage = (v: string | null | undefined): string | null => (v && v !== "none" ? v : null);
import { resolvePromotion } from "@/lib/promotions";
import { formatSportRecord } from "@/lib/sports";
import { safeFighterImageOrNull } from "@/lib/media-safe";
import { SPORTS } from "@/lib/sports";
import { recommendVideos } from "@/lib/feed/recommend";
import { getMyPicksForFightIds, getCrowdForFightIds } from "@/lib/picks";
import { publicDisplayName } from "@/lib/display-name";

/**
 * Lowercase only the first character.
 *
 * Activity titles are stored verb-first and capitalised, from the actor's own point
 * of view — "Won a battle vs Dana", "Earned a rare card", "Correctly picked Volk".
 * Prefixing the actor's name needs that leading verb in lower case
 * ("Alice won a battle vs Dana"). Only the first character is touched, so the proper
 * nouns later in the string are left exactly as they were.
 */
const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

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
  | "person"           // something a PERSON you follow did (the social feed)
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
  /** Present only on kind === "person": who did the thing, so the card can name
   *  and link them. `displayName` is already privacy-resolved (publicDisplayName),
   *  never the raw account name or email. */
  person?: { username: string | null; displayName: string; avatar: string | null };
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
      /** Countdown label ("Fight day" / "Tomorrow" / "In 6d"), computed on the
       *  server so the card stays a pure render (no Date.now at paint). */
      countdown: string;
      /** True inside 48h — the card raises the countdown's colour. */
      urgent: boolean;
      // ── Living-fight signals ────────────────────────────────────────────
      // All four come from data that ALREADY exists, batch-loaded once for the
      // whole feed (picks, crowd, odds, room). Each is null when there is
      // nothing to say, so the card only ever shows signals it can back up —
      // and the fighter card stops being a poster and becomes a fight you can
      // act on without opening another screen.
      /** The viewer's own pick on this bout, so the card can say "you called
       *  it" instead of asking again. Null → the CTA is "Predict". */
      predicted: { corner: "RED" | "BLUE"; name: string } | null;
      /** The community split (fan picks), red vs blue. Null when nobody has
       *  called it yet — an empty bar is noise, not information. */
      crowd: { redName: string; redPct: number; blueName: string; bluePct: number; total: number } | null;
      /** Bookmaker-implied favourite — labelled Market, kept visually distinct
       *  from the crowd so the two percentages can never be confused. */
      odds: { favName: string; favPct: number } | null;
      /** Live reply count in the bout's room, when the conversation is real. */
      discussion: number | null;
    } | null;
    /** Whether fight alerts will actually reach them, so the card can state it
     *  truthfully instead of implying it. */
    notifications: boolean;
    /** A short "something changed" flag, DERIVED from the fight rows already
     *  loaded — no poll, no new table, no extra query. Null when there is
     *  nothing new, because a badge that is always on is not a badge. */
    badge: string | null;
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

/** Latest bookmaker-implied probabilities for a set of bouts, in ONE read.
 *  Rows come back newest-first, so the first hit per fight is the current line. */
async function latestOddsFor(
  fightIds: string[],
): Promise<Map<string, { redImplied: number; blueImplied: number }>> {
  const out = new Map<string, { redImplied: number; blueImplied: number }>();
  if (!fightIds.length) return out;
  const rows = await prisma.oddsSnapshot.findMany({
    where: { fightId: { in: fightIds } },
    orderBy: { capturedAt: "desc" },
    select: { fightId: true, redImplied: true, blueImplied: true },
  });
  for (const r of rows) {
    if (!out.has(r.fightId)) out.set(r.fightId, { redImplied: r.redImplied, blueImplied: r.blueImplied });
  }
  return out;
}

/** Reply counts for the bouts' rooms, in ONE read. The count is denormalised on
 *  the thread (ForumThread.replyCount), so this never touches the posts table. */
async function discussionFor(fightIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!fightIds.length) return out;
  const rows = await prisma.forumThread.findMany({
    where: { fightId: { in: fightIds } },
    select: { fightId: true, replyCount: true },
  });
  for (const r of rows) if (r.fightId) out.set(r.fightId, r.replyCount);
  return out;
}

/**
 * "Something changed" for a fighter, derived from the booking already in hand.
 *
 * Announced within the last week is genuinely new. Otherwise, a card inside the
 * pick window is worth flagging because there is an action to take. Everything
 * else gets nothing — a badge on every card is decoration, not information.
 */
function fighterBadge(
  nf: { date: Date; createdAt: Date } | undefined,
  now: Date,
): string | null {
  if (!nf) return null;
  const WEEK = 7 * 86_400_000;
  if (now.getTime() - nf.createdAt.getTime() < WEEK) return "New fight announced";
  if (nf.date.getTime() - now.getTime() < 14 * 86_400_000) return "Prediction open";
  return null;
}

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
  const [events, fighters, promotions, people, me] = await Promise.all([
    prisma.favoriteEvent.findMany({ where: { userId }, select: { eventId: true } }),
    prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } }),
    prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } }),
    // The user→user graph. This is what makes the Feed tab a feed of PEOPLE
    // rather than a second copy of the Events tab.
    prisma.userFollow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { sportPrefs: true, notifyFights: true } }),
  ]);
  return {
    eventIds: events.map((e) => e.eventId),
    fighterIds: fighters.map((f) => f.fighterId),
    promotions: promotions.map((p) => p.promotion),
    followedUserIds: people.map((p) => p.followingId),
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
  const { eventIds, fighterIds, promotions, followedUserIds, disciplines, notifyFights } = await getFollowGraph(userId);
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

  const [upcomingEvents, results, fighterFights, personal, coverage, peopleActivity] = await Promise.all([
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
            id: true, slug: true, date: true, titleFight: true, createdAt: true,
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
          select: { id: true, slug: true, title: true, publishedAt: true, coverImageUrl: true, ogImageUrl: true, category: true, author: { select: { name: true } } },
        })
      : Promise.resolve([]),

    // What the PEOPLE you follow have been doing. One query for the whole follow
    // list, ordered by the [userId, createdAt] index on Activity.
    //
    // This is the band that makes the Feed tab its own thing. Before it, "Feed"
    // and "Events" were both built from the same event/result rows, so the Feed
    // was the Events tab plus news — which is exactly the duplication a reader
    // notices and cannot name.
    followedUserIds.length
      ? prisma.activity.findMany({
          where: { userId: { in: followedUserIds }, createdAt: { gte: recently } },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true, type: true, title: true, url: true, createdAt: true,
            user: { select: { name: true, username: true, image: true } },
          },
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
      icon: "scheduled",
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
      icon: "results",
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

  // Living-fight enrichment for the bouts these cards will show — FOUR fixed
  // batched reads for the whole feed (your picks · the crowd · the odds · the
  // room), never one per card. Keyed by the next-fight ids only, so a card with
  // no booking costs nothing here.
  const nextFightIds = [...new Set(fighterCards.map((fr) => nextByFighter.get(fr.id)?.id).filter((v): v is string => !!v))];
  const [myPicks, crowds, oddsByFight, discussionByFight] = await Promise.all([
    getMyPicksForFightIds(userId, nextFightIds),
    getCrowdForFightIds(nextFightIds),
    latestOddsFor(nextFightIds),
    discussionFor(nextFightIds),
  ]);

  for (const fr of fighterCards) {
    const nf = nextByFighter.get(fr.id);
    const opponent = nf ? (nf.red.id === fr.id ? nf.blue : nf.red) : null;
    const promo = nf?.event ? resolvePromotion(nf.event.promotion ?? null) : null;
    const rk = rankByFighter.get(fr.id);

    // Resolve the living-fight signals for this bout (all null-safe: a bout with
    // no picks/odds/room simply shows fewer signals, never an empty widget).
    const pick = nf ? myPicks.get(nf.id) : undefined;
    const crowd = nf ? crowds.get(nf.id) : undefined;
    const odds = nf ? oddsByFight.get(nf.id) : undefined;
    const replies = nf ? discussionByFight.get(nf.id) : undefined;
    const oddsRedFav = odds ? odds.redImplied >= odds.blueImplied : false;

    items.push({
      id: `fr-${fr.id}`,
      kind: "fighter",
      // A booked fighter sorts by how soon they fight; an unbooked one sits at
      // the point they were followed rather than claiming the top of the feed.
      at: nf ? iso(new Date(now.getTime() + Math.max(0, nf.date.getTime() - now.getTime()) / 1000 + 1)) : iso(recently),
      title: fr.name,
      body: null,
      url: `/fighters/${fr.slug}`,
      icon: "fight",
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
              countdown: (() => {
                const d = days(nf.date);
                return d <= 0 ? "Fight day" : d === 1 ? "Tomorrow" : d <= 7 ? `In ${d}d` : `In ${Math.round(d / 7)}w`;
              })(),
              urgent: days(nf.date) <= 2,
              predicted: pick
                ? { corner: pick.corner, name: pick.corner === "RED" ? nf.red.name : nf.blue.name }
                : null,
              crowd: crowd && crowd.total > 0
                ? {
                    redName: nf.red.name,
                    redPct: Math.round((crowd.red / crowd.total) * 100),
                    blueName: nf.blue.name,
                    bluePct: Math.round((crowd.blue / crowd.total) * 100),
                    total: crowd.total,
                  }
                : null,
              odds: odds
                ? {
                    favName: oddsRedFav ? nf.red.name : nf.blue.name,
                    favPct: Math.round((oddsRedFav ? odds.redImplied : odds.blueImplied) * 100),
                  }
                : null,
              discussion: replies && replies > 0 ? replies : null,
            }
          : null,
        notifications: notifyFights,
        badge: fighterBadge(nf, now),
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

  // People you follow. `publicDisplayName` is not optional here: User.name has
  // historically held email-derived values, and this band renders a name to
  // strangers — so it goes through the same privacy resolver every other public
  // surface uses rather than reading `name` directly.
  for (const a of peopleActivity) {
    const displayName = publicDisplayName(a.user);
    items.push({
      id: `ac-${a.id}`,
      kind: "person",
      at: iso(a.createdAt),
      // The stored title is written from the actor's own point of view ("Called
      // Gaethje by KO"), so it is prefixed with who did it to read correctly in
      // someone else's feed.
      title: `${displayName} ${lowerFirst(a.title)}`,
      body: null,
      // Fall back to the person's profile: an activity row whose subject has since
      // been deleted still has a person worth visiting.
      url: a.url ?? (a.user.username ? `/u/${a.user.username}` : "/following"),
      icon: "person",
      meta: null,
      person: {
        username: a.user.username,
        displayName,
        avatar: safeFighterImageOrNull(a.user.image),
      },
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
      icon: "news",
      meta: a.author?.name ?? null,
      media: {
        // safeNewsCover keeps the deliberate legal line: a publisher image is
        // used only when it is licensed syndication, otherwise we draw our own
        // rather than hotlinking someone's server.
        image: safeNewsCover(a.slug, a.coverImageUrl ?? ogImage(a.ogImageUrl)) || brandedHero(a.slug, null, null),
        generated: !a.coverImageUrl && !ogImage(a.ogImageUrl),
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
    icon: "video",
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
  // Same family as `personal`: both render as the compact one-line row, so to the
  // eye a run of them is one run, which is what the rule is measuring.
  person: "personal",
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
    // `lastFamily !== "video"` matters: the run-breaker below can also place a
    // video, and without this guard a video placed there followed immediately
    // by the interval boundary put two back to back.
    if (out.length && out.length % VIDEO_EVERY === 0 && vi < queue.length && lastFamily !== "video") {
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
      // Pull the highest-ranked item of a DIFFERENT family forward.
      const alt = pending.findIndex((it) => FAMILY[it.kind] !== lastFamily);
      if (alt !== -1) {
        idx = alt;
      } else if (vi < queue.length && lastFamily !== "video") {
        // The timeline has nothing else, but a VIDEO is still queued — and a
        // queued video is a different family. Not checking here is how six
        // consecutive news items shipped while a video sat unused two lines
        // later: the run-breaker only ever looked at `pending`.
        out.push(queue[vi++]);
        lastFamily = "video";
        run = 1;
        continue;
      }
      // Nothing of another family anywhere: a user who follows only events
      // genuinely has an event feed, and the run continues rather than the
      // feed going short.
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
          icon: "podcast",
          meta: a.author ? publicDisplayName(a.author) : "Combat Reviews",
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
