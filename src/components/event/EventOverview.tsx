import { ArrowRight, MessagesSquare, Newspaper, Radio, Vote } from "lucide-react";
import type { Article, Event, Fight, Promotion, Venue } from "@/lib/domain/types";
import { getAthlete, getMarketsForEvent, getPostsForEvent } from "@/lib/data/store";
import { buildPredictionSummary } from "@/lib/domain/predictionSummary";
import { formatLocalTime } from "@/lib/domain/format";
import { SectionLink } from "./EventSectionNavigation";
import { CoverageCard } from "@/components/coverage/CoverageCard";

/**
 * Overview: a concise, scannable digest of the event that funnels the user into
 * the deeper sections. It never duplicates those sections — it summarises and
 * links (via in-place tab switches, keeping the user on the same event).
 */
export function EventOverview({
  event,
  promotion,
  venue,
  fights,
  articles,
}: {
  event: Event;
  promotion?: Promotion;
  venue?: Venue;
  fights: Fight[];
  articles: Article[];
}) {
  const markets = getMarketsForEvent(event.id);
  const summary = buildPredictionSummary(markets, fights);
  const posts = getPostsForEvent(event.id);
  const featured = articles[0];

  const headline = fights.find((f) => f.id === event.headlineFightId);
  const headlineText = headline
    ? headline.participants
        .map((p) => getAthlete(p.athleteId).name.split(" ").pop())
        .join(" vs ")
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      {event.description ? (
        <p className="text-sm leading-relaxed text-muted">{event.description}</p>
      ) : null}

      {/* Quick facts */}
      <dl className="grid grid-cols-2 gap-2">
        {event.mainCardStartsAt && venue ? (
          <Fact label="Main card">{formatLocalTime(event.mainCardStartsAt, venue.timezone)}</Fact>
        ) : null}
        {event.broadcasts[0] ? (
          <Fact label="Watch" icon={<Radio className="h-3.5 w-3.5" />}>
            {event.broadcasts[0].channel}
          </Fact>
        ) : null}
        {promotion ? <Fact label="Promotion">{promotion.name}</Fact> : null}
        {headlineText ? <Fact label="Headline">{headlineText}</Fact> : null}
      </dl>

      {/* Featured preview */}
      {featured ? (
        <div>
          <SectionHeader label="Featured coverage" to="coverage" cta="All coverage" />
          <CoverageCard article={featured} />
        </div>
      ) : null}

      {/* Prediction snapshot */}
      {summary.boutsWithMarkets > 0 ? (
        <SectionLink
          to="predictions"
          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 text-left transition-colors hover:border-brand/50"
        >
          <Vote className="h-5 w-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Predictions</p>
            <p className="text-xs text-muted">
              {summary.totalVotes.toLocaleString()} picks across {summary.boutsWithMarkets} bouts
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-faint" />
        </SectionLink>
      ) : null}

      {/* Discussion snapshot */}
      <SectionLink
        to="discussion"
        className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 text-left transition-colors hover:border-brand/50"
      >
        <MessagesSquare className="h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Discussion</p>
          <p className="text-xs text-muted">
            {posts.length > 0 ? `${posts.length} posts in the event thread` : "Be the first to post"}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-faint" />
      </SectionLink>

      {/* Card jump */}
      <SectionLink
        to="card"
        className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 text-left transition-colors hover:border-brand/50"
      >
        <Newspaper className="h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Full fight card</p>
          <p className="text-xs text-muted">{event.fightIds.length} bouts scheduled</p>
        </div>
        <ArrowRight className="h-4 w-4 text-faint" />
      </SectionLink>
    </div>
  );
}

function Fact({ label, children, icon }: { label: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

function SectionHeader({ label, to, cta }: { label: string; to: string; cta: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="eyebrow">{label}</h3>
      <SectionLink to={to} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand">
        {cta} <ArrowRight className="h-3 w-3" />
      </SectionLink>
    </div>
  );
}
