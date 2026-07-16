import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Newspaper, Vote, MessagesSquare, Radio } from "lucide-react";
import type { Article, Fight, FightEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { safeNewsCover } from "@/lib/media-safe";
import { SectionLink } from "./event-section-nav";

/**
 * Overview leads with the ONE thing the user came for — the headline bout, its
 * market read, and the freshest coverage — then hands off to the other tabs. It
 * deliberately does NOT dump the whole card; that lives one tap away.
 */
export function EventOverview({
  event,
  headline,
  articles,
  fightCount,
  coverageCount,
}: {
  event: FightEvent;
  headline?: Fight;
  articles: Article[];
  fightCount: number;
  coverageCount: number;
}) {
  const featured = articles[0];
  const summary = headline
    ? `${headline.weightClass ? headline.weightClass + " " : ""}card${event.city ? ` live from ${event.city}` : ""}, headlined by ${headline.red.name} vs ${headline.blue.name}.`
    : `${fightCount} bout${fightCount === 1 ? "" : "s"} on the card.`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-mist">{summary}</p>

      <dl className="grid grid-cols-2 gap-2">
        {event.promotion && event.promotion !== "Various" && <Fact label="Promotion">{event.promotion}</Fact>}
        {event.broadcaster && (
          <Fact label="Watch" icon={<Radio className="size-3.5" />}>
            {event.broadcaster}
          </Fact>
        )}
        <Fact label="Bouts">{fightCount}</Fact>
        {headline && (
          <Fact label="Headline">
            {`${headline.red.name.split(" ").pop()} vs ${headline.blue.name.split(" ").pop()}`}
          </Fact>
        )}
      </dl>

      {/* Featured coverage */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow">Featured coverage</h3>
          <SectionLink to="coverage" className="inline-flex items-center gap-0.5 text-xs font-medium text-blood-400">
            All coverage <ArrowRight className="size-3" />
          </SectionLink>
        </div>
        {featured ? (
          <Link
            href={`/news/${featured.slug}`}
            className="flex gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 transition-colors hover:border-blood-500/40"
          >
            <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-ink-800">
              {/* Feed cover when available (via /api/img), else generated category art. */}
              <Image
                src={safeNewsCover(featured.slug, featured.coverImageUrl)}
                alt=""
                fill
                className="object-cover"
                sizes="64px"
                unoptimized
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-blood-500/30 bg-blood-500/15 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wider text-blood-300">
                {featured.category || "News"}
              </span>
              <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-chalk">{featured.title}</h4>
              {featured.excerpt && <p className="mt-0.5 line-clamp-2 text-xs text-mist">{featured.excerpt}</p>}
              <p className="mt-1 text-[11px] text-fog">
                {[featured.author, formatDate(featured.publishedAt, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}
              </p>
            </div>
          </Link>
        ) : (
          <p className="rounded-xl border border-ink-700 bg-ink-900 p-3 text-xs text-fog">
            No coverage connected for this event yet.
          </p>
        )}
      </div>

      {/* Hand-offs to the deeper tabs */}
      <JumpTile to="predictions" icon={<Vote className="size-5 text-blood-400" />} title="Predictions" sub="Market lines & win probability" />
      <JumpTile to="discussion" icon={<MessagesSquare className="size-5 text-blood-400" />} title="Discussion" sub="Talk this card with the community" />
      <JumpTile to="card" icon={<Newspaper className="size-5 text-blood-400" />} title="Full fight card" sub={`${fightCount} bout${fightCount === 1 ? "" : "s"} scheduled`} />
    </div>
  );
}

function Fact({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-800 px-3 py-2">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-fog">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-chalk">{children}</dd>
    </div>
  );
}

function JumpTile({ to, icon, title, sub }: { to: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <SectionLink
      to={to}
      className="flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3.5 text-left transition-colors hover:border-blood-500/40"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-chalk">{title}</span>
        <span className="block text-xs text-mist">{sub}</span>
      </span>
      <ArrowRight className="size-4 text-fog" />
    </SectionLink>
  );
}
