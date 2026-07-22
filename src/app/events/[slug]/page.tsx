import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getEvent, getEventCoverage, getOddsForFight } from "@/lib/repo";
import { marketProbability, type MarketProb } from "@/lib/market";
import { safeNewsCover } from "@/lib/media-safe";
import type { Article, Fight } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { orderFights, rankCoverage, groupCoverage, winningCorner } from "@/lib/event-format";
import { recommendVideos } from "@/lib/feed/recommend";
import { VideoRail } from "@/components/feed/video-rail";
import { resolvePromotion } from "@/lib/promotions";
import { getCurrentUser } from "@/lib/auth";
import { isFollowingPromotion, isFollowingEvent } from "@/lib/follows";
import { getEventPickSummary } from "@/lib/profile-stats";
import { getCrowdForFightIds, getMyPicksForFightIds, type CrowdRead, type MyPick } from "@/lib/picks";
import { getRoomSummaries } from "@/lib/community/rooms";
import { prisma } from "@/lib/db";
import { ResultReveal } from "@/components/event/result-reveal";
import { EventHeader } from "@/components/event/event-header";
import { EventSchedule } from "@/components/event/event-schedule";
import { HeadlineMatchup } from "@/components/event/headline-matchup";
import { EventScrollSpy, type SpySection } from "@/components/event/event-scroll-spy";
import { segmentCard, estimateBoutTimes, currentBoutId, boutProgress } from "@/lib/card-segments";
import { FightRow } from "@/components/event/fight-row";
import { BoutPick } from "@/components/predictions/bout-pick";
import { FightModule } from "@/components/fight/fight-module";
import { EventGeneralRoom } from "@/components/event/event-general-room";
import { WhenVisible } from "@/components/when-visible";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const e = await getEvent(slug);
  if (!e) return {};
  return {
    title: e.name,
    description: `${e.name} — headline matchup, full fight card, coverage, predictions and discussion in one place.`,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) notFound();

  // Read in the order fans expect: main event, co-main, titles, then the
  // official undercard order.
  const fights = orderFights(event.fights);
  const headline = fights.find((f) => f.mainEvent) ?? fights[0];

  // The card as a fan watches it: broadcast blocks in run order, each bout with
  // an estimated walkout time and where it sits in the night. `derived` is true
  // when no provider gave us blocks — every time is then labelled an estimate.
  const { derived: segmentsDerived, blocks } = segmentCard(fights);
  const eventDate = new Date(event.date);
  const boutTimes = estimateBoutTimes(blocks, eventDate);
  const liveBoutId = currentBoutId(blocks, event.status);

  // Real market-implied probability per bout, from the licensed odds feed.
  const oddsList = await Promise.all(fights.map((f) => getOddsForFight(f.slug)));
  const marketBySlug = new Map<string, MarketProb | null>(
    fights.map((f, i) => [f.slug, marketProbability(oddsList[i])]),
  );

  // Coverage: articles that name a fighter on this card or the promotion,
  // queried across the WHOLE news table (not just the recent 60) so a
  // promotion's stories surface instead of the generic MMA firehose. No match
  // → empty panel, never unrelated news.
  // Pull a wide pool, then rank toward high-value stories (press conference,
  // weigh-ins, faceoffs, fighter updates, predictions) and drop duplicates.
  const coveragePool = await getEventCoverage(coverageTerms(event.promotion, fights, event.name), 30);
  const coverage = rankCoverage(coveragePool, 8);

  // Video for THIS card, windowed hard around the event date.
  //
  // Without the window a promotion-slug match would happily put last year's
  // Embedded on next month's card — the promotion is right and the event is
  // not, which is exactly the failure the product called out. Fight-week video
  // lands in the ~3 weeks before a card; afterwards the same window keeps the
  // highlights and post-fight reaction attached to the card they belong to.
  const eventVideos = await recommendVideos({
    promotions: [resolvePromotion(event.promotion).slug],
    fighterNames: fights.flatMap((f) => [f.red.name, f.blue.name]),
    publishedAfter: new Date(eventDate.getTime() - 21 * 86_400_000),
    publishedBefore: new Date(eventDate.getTime() + 10 * 86_400_000),
    viewerId: (await getCurrentUser())?.id ?? null,
    limit: 4,
  });

  // Promotion personality: every event uses the SAME layout, but its promotion's
  // brand colour flows through the hero/schedule/main-event accents via --accent.
  const accent = resolvePromotion(event.promotion).brand;

  // Is the viewer following this promotion? (drives the header follow button)
  const viewer = await getCurrentUser();
  const [promotionFollowing, eventFollowing] = viewer
    ? await Promise.all([
        event.promotion ? isFollowingPromotion(viewer.id, event.promotion) : Promise.resolve(false),
        isFollowingEvent(viewer.id, event.id),
      ])
    : [false, false];

  // Crowd predictions for the whole card in TWO queries (batched — no N+1): the
  // aggregate read for everyone, and this viewer's own picks. Same store and the
  // same /api/fights/[slug]/pick write BoutPick uses on /predictions — one source
  // of truth, not a parallel prediction system.
  const fightIds = fights.map((f) => f.id);
  const [crowdByFightId, myPicksByFightId, roomsByFightId] = await Promise.all([
    getCrowdForFightIds(fightIds),
    viewer ? getMyPicksForFightIds(viewer.id, fightIds) : Promise.resolve(new Map<string, MyPick>()),
    // Battle Rooms: the room counters + the viewer's battle per bout, for the WHOLE
    // card in three queries. Nothing is provisioned and no discussion is fetched
    // until a reader opens an arena — that work belongs to /api/fights/[slug]/room.
    getRoomSummaries(fightIds, viewer?.id),
  ]);

  // Result reveal — only on a completed event, only for a viewer who made picks.
  const isCompleted = event.status === "COMPLETED";
  const [pickSummary, viewerStreak] = viewer && isCompleted
    ? await Promise.all([
        getEventPickSummary(viewer.id, fights.map((f) => f.id)),
        prisma.user.findUnique({ where: { id: viewer.id }, select: { pickStreak: true } }).then((u) => u?.pickStreak ?? 0),
      ])
    : [null, 0];

  // One scroll: card → card talk → coverage. There is no separate Predictions
  // section — a bout's prediction, battle and discussion live inside that bout's
  // module, because that is the scope a fan actually thinks in. "Card talk" is
  // the event-wide room for everything that belongs to no single bout.
  const spy: SpySection[] = [
    { id: "card", label: "Fight card", badge: fights.length },
    { id: "card-talk", label: "Card talk" },
    ...(coverage.length || eventVideos.length
      ? [{ id: "coverage", label: "Coverage", badge: coverage.length + eventVideos.length } satisfies SpySection]
      : []),
  ];

  return (
    <div style={{ "--accent": accent } as React.CSSProperties}>
      {/* Hero → Schedule (when) → Headline (the fight) — the top of the funnel. */}
      <EventHeader
        event={event}
        promotionFollowing={promotionFollowing}
        eventFollowing={eventFollowing}
        boutCount={fights.length}
      />
      {pickSummary && <ResultReveal summary={pickSummary} streak={viewerStreak} />}
      <EventSchedule
        date={event.date}
        status={event.status}
        estimated={segmentsDerived}
        blocks={blocks.map((b) => ({
          key: b.meta.key,
          label: b.meta.label,
          startsAt: new Date(eventDate.getTime() - b.meta.offsetMinutes * 60_000).toISOString(),
          bouts: b.fights.length,
        }))}
      />
      {headline && <HeadlineMatchup fight={headline} market={marketBySlug.get(headline.slug) ?? null} />}

      {/* Sticky scroll-spy, then the sections continuously below it. */}
      <EventScrollSpy sections={spy} />

      {/* The card IS the product surface: every bout is an independent module
          carrying its own prediction, battle and discussion. */}
      <ScrollSection id="card" title="Fight card" seam={false}>
        <div className="flex flex-col gap-10">
          {blocks.map((block) => (
            <section key={block.meta.key} aria-label={block.meta.label}>
              {/* Only head a block when the card actually splits into more than
                  one — a 5-bout show is just "the card". */}
              {blocks.length > 1 && (
                <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-ink-800 pb-2">
                  <h3 className="font-display text-base font-bold text-chalk">{block.meta.label}</h3>
                  <span className="text-[0.7rem] uppercase tracking-wider text-fog">
                    {block.fights.length} bout{block.fights.length === 1 ? "" : "s"}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-8">
                {block.fights.map((f) => (
                  <FightModule
                    key={f.id}
                    fightSlug={f.slug}
                    summary={roomsByFightId.get(f.id) ?? { voices: 0, battle: null }}
                    header={
                      <FightRow
                        fight={f}
                        index={fights.indexOf(f)}
                        market={marketBySlug.get(f.slug) ?? null}
                        estimatedAt={boutTimes.get(f.id)?.toISOString() ?? null}
                        estimated={segmentsDerived}
                        progress={boutProgress(f, f.id === liveBoutId)}
                      />
                    }
                    pick={
                      <BoutPrediction
                        fight={f}
                        crowd={crowdByFightId.get(f.id) ?? { red: 0, blue: 0, total: 0 }}
                        myPick={myPicksByFightId.get(f.id) ?? null}
                        market={marketBySlug.get(f.slug) ?? null}
                      />
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </ScrollSection>

      {/* Card-wide talk. Provisioned only when the reader reaches it, so the
          write stays off every page load. */}
      <ScrollSection id="card-talk" title="Card talk">
        <WhenVisible placeholder={<RoomSkeleton />}>
          <EventGeneralRoom slug={event.slug} />
        </WhenVisible>
      </ScrollSection>

      {coverage.length > 0 && (
        <ScrollSection id="coverage" title="Related coverage">
          {/* Video sits INSIDE the coverage section rather than claiming a
              scroll-spy section of its own: it is the same job as the articles
              below it — what else there is to consume about this card. */}
          <VideoRail videos={eventVideos} title="Watch" moreHref="/clips" />
          <CoveragePanel articles={coverage} />
        </ScrollSection>
      )}

      {/* Tail space so the last section can scroll clear of the sticky rail and
          the bottom tab bar — no abrupt end to the document. */}
      <div className="h-16" aria-hidden />
    </div>
  );
}

/** Space-holding skeleton while a room mounts — no words, no spinner, no mention
 *  of loading; it simply reads as the conversation settling in. */
function RoomSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-3" aria-hidden>
      <div className="h-11 rounded-xl bg-ink-800/50" />
      <div className="h-24 rounded-xl bg-ink-900/70 ring-1 ring-ink-800/60" />
      <div className="ml-6 h-16 rounded-xl bg-ink-900/50 ring-1 ring-ink-800/50" />
    </div>
  );
}

/**
 * One section of the single-scroll event page. Centralises the rhythm so every
 * section breathes identically: consistent padding, a hairline seam (softer than
 * a hard rule) between sections, a quiet eyebrow title, `scroll-mt` so the sticky
 * rail never covers the heading on a jump, and a scroll-driven reveal as it
 * arrives. `id` is the scroll-spy anchor.
 */
function ScrollSection({
  id,
  title,
  seam = true,
  children,
}: {
  id: string;
  title: string;
  seam?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`reveal scroll-mt-16 px-4 py-8 ${seam ? "border-t border-ink-800/50" : ""}`}
    >
      <h2 className="mb-4 font-display text-sm font-bold uppercase tracking-[0.18em] text-fog">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The prediction slot inside a bout's module. A scheduled bout renders the real
 * crowd-pick control (BoutPick — same component and backend everywhere); a decided
 * bout collapses to its outcome and how the crowd called it. The battle and the
 * discussion that hang off this prediction live one block below, in the arena.
 */
function BoutPrediction({ fight, crowd, myPick, market }: { fight: Fight; crowd: CrowdRead; myPick: MyPick | null; market: MarketProb | null }) {
  if (fight.result === "SCHEDULED") {
    return (
      <BoutPick
        fightSlug={fight.slug}
        redName={fight.red.name}
        blueName={fight.blue.name}
        initialCrowd={crowd}
        initialPick={myPick}
        marketRedP={market?.redP ?? null}
      />
    );
  }

  const won = winningCorner(fight);
  const winner = won === "red" ? fight.red : won === "blue" ? fight.blue : null;
  const crowdRight = won === "red" ? crowd.red : won === "blue" ? crowd.blue : 0;
  const pct = crowd.total ? Math.round((crowdRight / crowd.total) * 100) : 0;
  return (
    <div className="card-surface pred-card p-4">
      <div className="mb-2 flex items-center justify-between text-sm font-semibold text-chalk">
        <span className="truncate">{fight.red.name}</span>
        <span className="px-2 text-xs text-fog">vs</span>
        <span className="truncate text-right">{fight.blue.name}</span>
      </div>
      <div className="rounded-lg bg-ink-800 px-3 py-2 text-sm">
        {winner ? (
          <p className="text-chalk">
            <span className="font-semibold text-blood-300">{winner.name}</span>{" "}
            <span className="text-fog">
              def.{fight.method ? ` · ${fight.method}${fight.roundEnded ? ` R${fight.roundEnded}` : ""}` : ""}
            </span>
          </p>
        ) : (
          <p className="text-mist">{fight.result === "DRAW" ? "Draw" : fight.result === "NO_CONTEST" ? "No contest" : "Result pending"}</p>
        )}
      </div>
      {crowd.total > 0 && winner && (
        <p className="mt-2 text-xs text-fog">
          <span className="font-semibold text-chalk">{pct}%</span> of {crowd.total.toLocaleString()} picks called it.
        </p>
      )}
    </div>
  );
}

// ── Coverage relevance ────────────────────────────────────────────────────
// Promotion → the title phrases that signal a story is about that promotion.
// (Bare "one" is deliberately excluded — it matches half of all headlines.)
const PROMO_ALIASES: Record<string, string[]> = {
  "one championship": ["one championship", "one fight night", "one friday fights", "onefc", "one fc"],
  bkfc: ["bkfc", "bare knuckle", "bare-knuckle"],
  adcc: ["adcc", "submission fighting"],
  ufc: ["ufc"],
  pfl: ["pfl", "professional fighters league"],
};

/**
 * The title-search terms that make an article "coverage" for this event: fighter
 * surnames on the card, the promotion (+ its aliases), and the event name. The
 * DB query (getEventCoverage) matches ANY term and returns [] when nothing
 * matches — so an event shows its own coverage or none, never a generic firehose.
 */
function coverageTerms(promotion: string | undefined, fights: Fight[], eventName: string): string[] {
  const terms = new Set<string>();

  // Fighter surnames on the card.
  for (const f of fights) {
    for (const name of [f.red.name, f.blue.name]) {
      const surname = name.split(" ").pop()?.toLowerCase() ?? "";
      if (surname.length > 2) terms.add(surname);
    }
  }

  // Promotion + its aliases.
  const promo = promotion?.toLowerCase().trim();
  if (promo && promo !== "various") {
    terms.add(promo);
    for (const alias of PROMO_ALIASES[promo] ?? []) terms.add(alias);
  }

  // The event's own name (e.g. "one fight night 50", "bkfc 91").
  const evName = eventName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (evName.length > 4) terms.add(evName);

  return [...terms].filter(Boolean);
}

// ── Panels ────────────────────────────────────────────────────────────────
function CoveragePanel({ articles }: { articles: Article[] }) {
  if (!articles.length) {
    return <p className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm text-fog">No coverage connected for this event yet.</p>;
  }
  // Reddit-style: grouped by topic with a heading + count per bucket.
  const groups = groupCoverage(articles);
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-base" aria-hidden>{g.emoji}</span>
            <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{g.label}</h3>
            <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-fog">
              {g.articles.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {g.articles.map((a) => (
              <Link
                key={a.id}
                href={`/news/${a.slug}`}
                className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 transition-all hover:-translate-y-0.5 hover:border-blood-500/40"
              >
                <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-ink-800">
                  {/* Real cover when the feed gives one (via /api/img), else locally
                      generated category art — never a torn/blank tile. */}
                  <Image src={safeNewsCover(a.slug, a.coverImageUrl)} alt="" fill className="object-cover" sizes="56px" unoptimized />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-chalk">{a.title}</h4>
                  <p className="mt-0.5 text-[11px] text-fog">
                    {[a.author, formatDate(a.publishedAt, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-fog" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
