import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, MessagesSquare, Trophy } from "lucide-react";
import { getEvent, getEventCoverage, getOddsForFight } from "@/lib/repo";
import { marketProbability, type MarketProb } from "@/lib/market";
import { safeNewsCover } from "@/lib/media-safe";
import type { Article, Fight } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { EventHeader } from "@/components/event/event-header";
import { HeadlineMatchup } from "@/components/event/headline-matchup";
import { EventOverview } from "@/components/event/event-overview";
import { EventSectionNavigation, type EventSection } from "@/components/event/event-section-nav";
import { FightCard } from "@/components/fight-card";
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

  const fights = event.fights;
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
  const coverage = await getEventCoverage(coverageTerms(event.promotion, fights, event.name), 12);

  const completed = fights.filter((f) => f.result !== "SCHEDULED");
  const withMarket = fights.filter((f) => marketBySlug.get(f.slug)).length;

  const sections: EventSection[] = [
    {
      id: "overview",
      label: "Overview",
      node: (
        <EventOverview
          event={event}
          headline={headline}
          articles={coverage}
          fightCount={fights.length}
          coverageCount={coverage.length}
        />
      ),
    },
    {
      id: "card",
      label: "Fight card",
      badge: fights.length,
      node: (
        <div className="grid gap-4 md:grid-cols-2">
          {fights.map((f) => (
            <FightCard key={f.id} fight={f} />
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
    {
      id: "results",
      label: "Results",
      badge: completed.length || undefined,
      node: <ResultsPanel fights={fights} />,
    },
  ];

  return (
    <>
      <EventHeader event={event} />
      {headline && <HeadlineMatchup fight={headline} market={marketBySlug.get(headline.slug) ?? null} />}
      <EventSectionNavigation sections={sections} initialId="overview" />
    </>
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
  return (
    <div className="flex flex-col gap-3">
      {articles.map((a) => (
        <Link
          key={a.id}
          href={`/news/${a.slug}`}
          className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 transition-colors hover:border-blood-500/40"
        >
          <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-ink-800">
            {/* Real cover when the feed gives one (via /api/img), else locally
                generated category art — never a torn/blank tile. */}
            <Image src={safeNewsCover(a.slug, a.coverImageUrl)} alt="" fill className="object-cover" sizes="64px" unoptimized />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-blood-300">{a.category || "News"}</span>
            <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-chalk">{a.title}</h4>
            <p className="mt-0.5 text-[11px] text-fog">
              {[a.author, formatDate(a.publishedAt, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}
            </p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-fog" />
        </Link>
      ))}
    </div>
  );
}

function PredictionsPanel({ fights, marketBySlug }: { fights: Fight[]; marketBySlug: Map<string, MarketProb | null> }) {
  return (
    <div className="flex flex-col gap-3">
      {fights.map((f) => {
        const market = marketBySlug.get(f.slug);
        return (
          <Link
            key={f.id}
            href={`/predictions/${f.slug}`}
            className="block rounded-xl border border-ink-700 bg-ink-900 p-3.5 transition-colors hover:border-blood-500/40"
          >
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-chalk">
              <span className="truncate">{f.red.name}</span>
              <span className="px-2 text-xs text-fog">vs</span>
              <span className="truncate text-right">{f.blue.name}</span>
            </div>
            {market ? (
              <>
                <ProbabilityBar redLabel={f.red.name} blueLabel={f.blue.name} redProbability={market.redP} compact />
                <p className="mt-1.5 text-right text-[11px] text-fog">Market implied · {market.books} book{market.books === 1 ? "" : "s"}</p>
              </>
            ) : (
              <p className="rounded-lg bg-ink-800 px-3 py-2 text-center text-xs text-fog">Awaiting live betting lines.</p>
            )}
          </Link>
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

function ResultsPanel({ fights }: { fights: Fight[] }) {
  const completed = fights.filter((f) => f.result !== "SCHEDULED");
  if (!completed.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-6 text-center">
        <Trophy className="size-7 text-fog" />
        <p className="text-sm text-mist">No results yet — bouts are still scheduled.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {completed.map((f) => {
        const winner = f.winnerId === f.red.slug ? f.red : f.winnerId === f.blue.slug ? f.blue : null;
        const loser = winner ? (winner.slug === f.red.slug ? f.blue : f.red) : null;
        return (
          <div key={f.id} className="rounded-xl border border-ink-700 bg-ink-900 p-3.5">
            {winner && loser ? (
              <p className="text-sm text-chalk">
                <span className="font-semibold text-blood-300">{winner.name}</span> def. {loser.name}
                {f.method ? <span className="text-fog"> · {f.method}{f.roundEnded ? ` R${f.roundEnded}` : ""}</span> : null}
              </p>
            ) : (
              <p className="text-sm text-mist">
                {f.red.name} vs {f.blue.name} · {f.result === "DRAW" ? "Draw" : f.result === "NO_CONTEST" ? "No contest" : f.result}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
