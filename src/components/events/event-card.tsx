import Image from "next/image";
import Link from "next/link";
import { MapPin, Swords, Tv } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { FollowButton } from "@/components/follow-button";
import { ShareMenu } from "@/components/share-menu";
import { AddToCalendar } from "@/components/event/add-to-calendar";
import { resolvePromotion } from "@/lib/promotions";
import { formatDate } from "@/lib/utils";
import type { EventCard as EventCardData } from "@/lib/events-query";

/**
 * One event, as a card.
 *
 * Hierarchy is deliberate: the MAIN EVENT is the largest thing on the card,
 * because that is what a fan recognises — not the promotion's numbering. Poster
 * artwork sits behind it when the promotion supplied one, and falls back to the
 * org's brand colour rather than a broken frame.
 *
 * Follow / Share / Calendar are the same components the event page uses, so an
 * action taken here behaves identically to one taken inside — no per-surface
 * variants, no duplicated logic.
 */
export function EventCard({ event }: { event: EventCardData }) {
  const accent = resolvePromotion(event.promotion).brand;
  const location = [event.city, event.country].filter(Boolean).join(", ");
  const isLive = event.status === "LIVE";
  const isDone = event.status === "COMPLETED";
  const isOff = event.status === "CANCELLED" || event.status === "POSTPONED";

  return (
    <article
      className="card-surface group relative overflow-hidden transition-colors hover:border-blood-500/40"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      {/* Poster, or the promotion's colour. Never an empty grey box. */}
      <div className="relative h-28 overflow-hidden sm:h-32">
        {event.posterUrl ? (
          <Image
            src={event.posterUrl}
            alt=""
            fill
            className="object-cover object-top transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, 640px"
            unoptimized
          />
        ) : (
          <div
            className="size-full"
            style={{ background: `radial-gradient(120% 140% at 20% 0%, color-mix(in srgb, ${accent} 45%, transparent), transparent 70%)` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="flex items-center gap-2">
            <PromotionLogo promotion={event.promotion} size="sm" />
            <span className="text-xs font-semibold uppercase tracking-wide text-chalk drop-shadow">{event.promotionName}</span>
          </span>
          <Badge tone={isLive ? "live" : isOff ? "neutral" : isDone ? "neutral" : "red"}>
            {isLive && <span className="live-dot" aria-hidden />} {event.status}
          </Badge>
        </div>

        {/* The headline bout — the biggest thing on the card. */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          {event.mainEvent ? (
            <p className="font-display text-lg font-black leading-tight text-chalk drop-shadow sm:text-xl">
              {event.mainEvent.red} <span className="text-blood-400">vs</span> {event.mainEvent.blue}
            </p>
          ) : (
            <p className="font-display text-lg font-black leading-tight text-chalk drop-shadow">{event.name}</p>
          )}
          {event.mainEvent && <p className="truncate text-xs text-mist">{event.name}</p>}
        </div>
      </div>

      <div className="p-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mist">
          <span>{formatDate(event.date, { weekday: "short", month: "short", day: "numeric" })}</span>
          <span className="inline-flex items-center gap-1 text-fog">
            <Swords className="size-3.5 text-blood-400" />{event.boutCount} bout{event.boutCount === 1 ? "" : "s"}
          </span>
          {location && (
            <span className="inline-flex min-w-0 items-center gap-1 text-fog">
              <MapPin className="size-3.5 text-blood-400" />
              <span className="truncate">{location}</span> <Flag code={event.countryCode} />
            </span>
          )}
          {event.broadcaster && (
            <span className="inline-flex min-w-0 items-center gap-1 text-fog">
              <Tv className="size-3.5 text-blood-400" /><span className="truncate">{event.broadcaster}</span>
            </span>
          )}
        </div>

        {event.venue && <p className="mt-1 truncate text-xs text-fog">{event.venue}</p>}

        {!isDone && !isOff && (
          <p className="mt-2.5 flex items-center gap-2 text-[0.65rem] uppercase tracking-wider text-fog">
            First bell <Countdown date={event.date} compact />
          </p>
        )}

        {/* Act without opening the event. Same components as the event page. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
          <FollowButton kind="event" slug={event.slug} initialFollowing={event.following} size="sm" label="Remind me" />
          {!isDone && !isOff && (
            <AddToCalendar
              slug={event.slug}
              name={event.name}
              date={event.date}
              location={[event.venue, event.city, event.country].filter(Boolean).join(", ")}
              broadcaster={event.broadcaster}
              bouts={event.boutCount}
              size="sm"
            />
          )}
          <ShareMenu path={`/events/${event.slug}`} title={event.name} compact />
          <Link
            href={`/events/${event.slug}`}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-blood-300 transition-colors hover:text-blood-200"
          >
            {isDone ? "Results" : "Full card"} →
          </Link>
        </div>
      </div>
    </article>
  );
}
