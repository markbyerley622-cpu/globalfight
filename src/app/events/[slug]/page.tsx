import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, MessagesSquare, PlayCircle } from "lucide-react";
import { getEvent, getEventCoverage, getOddsForFight } from "@/lib/repo";
import { marketProbability, type MarketProb } from "@/lib/market";
import { safeNewsCover } from "@/lib/media-safe";
import type { Article, Fight } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { orderFights, highlightsUrl, rankCoverage, groupCoverage, winningCorner } from "@/lib/event-format";
import { resolvePromotion } from "@/lib/promotions";
import { EventHeader } from "@/components/event/event-header";
import { EventSchedule } from "@/components/event/event-schedule";
import { HeadlineMatchup } from "@/components/event/headline-matchup";
import { EventSectionNavigation, type EventSection } from "@/components/event/event-section-nav";
import { FightRow } from "@/components/event/fight-row";
import { ProbabilityBar } from "@/components/probability-bar";

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

  const withMarket = fights.filter((f) => marketBySlug.get(f.slug)).length;

  // Tabs: Fight card (default) → Coverage → Predictions → Discussion. No
  // Overview (redundant) and no Results tab — the prediction cards transform
  // into results once a bout is decided, keeping one continuous surface.
  const sections: EventSection[] = [
    {
      id: "card",
      label: "Fight card",
      badge: fights.length,
      node: (
        <div className="flex flex-col gap-3">
          {fights.map((f, i) => (
            <FightRow key={f.id} fight={f} index={i} market={marketBySlug.get(f.slug) ?? null} />
          ))}
        </div>
      ),
    },
    {
      id: "coverage",
      label: "Coverage",
      badge: coverage.length || undefined,
      node: <CoveragePanel articles={coverage} />,
    },
    {
      id: "predictions",
      label: "Predictions",
      badge: withMarket || undefined,
      node: <PredictionsPanel fights={fights} marketBySlug={marketBySlug} />,
    },
    {
      id: "discussion",
      label: "Discussion",
      node: <DiscussionPanel eventName={event.name} />,
    },
  ];

  // Promotion personality: every event uses the SAME layout, but its promotion's
  // brand colour flows through the hero/schedule/main-event accents via --accent.
  const accent = resolvePromotion(event.promotion).brand;

  return (
    <div style={{ "--accent": accent } as React.CSSProperties}>
      {/* Hero → Schedule → Main event → tabbed card. Same order, every event. */}
      <EventHeader event={event} />
      <EventSchedule date={event.date} status={event.status} />
      {headline && <HeadlineMatchup fight={headline} market={marketBySlug.get(headline.slug) ?? null} />}
      <EventSectionNavigation sections={sections} initialId="card" />
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

/**
 * Predictions that become results. Before a bout: market-implied win
 * probability. After it's decided: the same card transforms into the outcome
 * (winner, method, round) with a highlights link — no separate Results tab, one
 * continuous surface so nothing is duplicated.
 */
function PredictionsPanel({ fights, marketBySlug }: { fights: Fight[]; marketBySlug: Map<string, MarketProb | null> }) {
  return (
    <div className="flex flex-col gap-3">
      {fights.map((f) => {
        const market = marketBySlug.get(f.slug);
        const done = f.result !== "SCHEDULED";
        const won = winningCorner(f);
        const winner = won === "red" ? f.red : won === "blue" ? f.blue : null;
        const loser = winner ? (winner.slug === f.red.slug ? f.blue : f.red) : null;
        return (
          <div
            key={f.id}
            className="rounded-xl border border-ink-700 bg-ink-900 p-3.5 transition-colors hover:border-blood-500/40"
          >
            <Link href={`/predictions/${f.slug}`} className="block">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold text-chalk">
                <span className="truncate">{f.red.name}</span>
                <span className="px-2 text-xs text-fog">vs</span>
                <span className="truncate text-right">{f.blue.name}</span>
              </div>

              {done ? (
                <div className="rounded-lg bg-ink-800 px-3 py-2 text-sm">
                  {winner && loser ? (
                    <p className="text-chalk">
                      <span className="font-semibold text-blood-300">{winner.name}</span>{" "}
                      <span className="text-fog">def.</span> {loser.name}
                      {f.method ? (
                        <span className="text-fog"> · {f.method}{f.roundEnded ? ` R${f.roundEnded}` : ""}</span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-mist">
                      {f.result === "DRAW" ? "Draw" : f.result === "NO_CONTEST" ? "No contest" : "Result pending"}
                    </p>
                  )}
                </div>
              ) : market ? (
                <>
                  <ProbabilityBar redLabel={f.red.name} blueLabel={f.blue.name} redProbability={market.redP} compact />
                  <p className="mt-1.5 text-right text-[11px] text-fog">Market implied · {market.books} book{market.books === 1 ? "" : "s"}</p>
                </>
              ) : (
                <p className="rounded-lg bg-ink-800 px-3 py-2 text-center text-xs text-fog">Awaiting live betting lines.</p>
              )}
            </Link>

            {done && (
              <a
                href={highlightsUrl(f)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blood-300 hover:text-blood-200"
              >
                <PlayCircle className="size-4" /> Highlights &amp; finish
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DiscussionPanel({ eventName }: { eventName: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-6 text-center">
      <MessagesSquare className="size-8 text-blood-400" />
      <p className="text-sm font-semibold text-chalk">Talk about {eventName}</p>
      <p className="max-w-xs text-xs text-mist">Break down the card, post your picks, and react live with the community.</p>
      <Link
        href="/forums"
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blood-600"
      >
        Open the forums <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
