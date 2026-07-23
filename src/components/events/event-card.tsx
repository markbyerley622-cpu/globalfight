import Image from "next/image";
import Link from "next/link";
import { MapPin, Swords, Tv, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { FollowButton } from "@/components/follow-button";
import { ShareMenu } from "@/components/share-menu";
import { AddToCalendar } from "@/components/event/add-to-calendar";
import { resolvePromotion } from "@/lib/promotions";
import { formatDate } from "@/lib/utils";
import { pickEventArtwork } from "@/lib/event-artwork";
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
      {/* Meaningful visual context, in priority order: event hero → poster →
          the two fighters facing each other → promotion colour. Never an empty box. */}
      <div className="relative h-28 overflow-hidden sm:h-32">
        <EventArtworkBackground event={event} accent={accent} />
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
          {/* A card whose bouts aren't published yet says nothing rather than
              advertising "0 bouts". */}
          {event.boutCount > 0 && (
            <span className="inline-flex items-center gap-1 text-fog">
              <Swords className="size-3.5 text-blood-400" />{event.boutCount} bout{event.boutCount === 1 ? "" : "s"}
            </span>
          )}
          {location && (
            <span className="inline-flex min-w-0 items-center gap-1 text-fog">
              <MapPin className="size-3.5 text-blood-400" />
              <span className="truncate">{location}</span> <Flag code={event.countryCode} />
            </span>
          )}
        </div>

        {event.venue && <p className="mt-1 truncate text-xs text-fog">{event.venue}</p>}

        {!isDone && !isOff && (
          <p className="mt-2.5 flex items-center gap-2 text-[0.65rem] uppercase tracking-wider text-fog">
            First bell <Countdown date={event.date} compact />
          </p>
        )}

        {/* WATCH + ATTEND — two of the six questions, as first-class actions
            (never hidden in a menu). "TBA" when the provider/vendor is unknown. */}
        {!isDone && !isOff && (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <ActionPill icon={Tv} label="Watch" value={event.broadcaster} href={event.eventUrl} />
            <ActionPill icon={Ticket} label="Tickets" value={event.ticketUrl ? "Buy" : null} href={event.ticketUrl} accent />
          </div>
        )}

        {/* Act without opening the event. Same components as the event page. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
          <FollowButton kind="event" slug={event.slug} name={event.name} initialFollowing={event.following} size="sm" label="Remind me" />
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
          {/* Primary CTA — the visual anchor of the action row: filled, high
              contrast, comfortably tappable. It is what the whole card is for. */}
          <Link
            href={`/events/${event.slug}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-3.5 py-2 text-xs font-bold text-white shadow-[0_6px_20px_-8px_rgba(225,29,42,0.7)] transition-colors hover:bg-blood-400"
          >
            {isDone ? "View results" : isLive ? "Watch live" : "Full card"} →
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * A "Watch" or "Tickets" pill. When a destination URL exists it becomes an
 * external link (accent-styled); otherwise it shows the value or a muted "TBA"
 * so the six-question card never simply omits how to watch / attend.
 */
function ActionPill({
  icon: Icon, label, value, href, accent = false,
}: { icon: LucideIcon; label: string; value: string | null; href: string | null; accent?: boolean }) {
  const shown = value ?? "TBA";
  const isTba = !value && !href;
  const body = (
    <>
      <Icon className={`size-3.5 shrink-0 ${isTba ? "text-fog" : "text-blood-400"}`} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[0.55rem] font-semibold uppercase tracking-wider text-fog">{label}</span>
        <span className={`truncate text-xs font-semibold ${isTba ? "text-fog" : "text-chalk"}`}>{shown}</span>
      </span>
    </>
  );
  const base = "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${accent ? "border-blood-500/50 bg-blood-500/10 hover:border-blood-500 hover:bg-blood-500/20" : "border-ink-700 bg-ink-950/40 hover:border-ink-600"}`}
      >
        {body}
      </a>
    );
  }
  return <span className={`${base} border-ink-800 bg-ink-950/30`}>{body}</span>;
}

/**
 * The card's background image, chosen deterministically (lib/event-artwork). When
 * no event artwork exists we compose the two main-event fighters facing centre —
 * the most commonly-available imagery — so a card is almost never a bare gradient.
 */
function EventArtworkBackground({ event, accent }: { event: EventCardData; accent: string }) {
  const art = pickEventArtwork(event);
  const brand = (
    <div
      className="size-full"
      style={{ background: `radial-gradient(120% 140% at 20% 0%, color-mix(in srgb, ${accent} 45%, transparent), transparent 70%)` }}
    />
  );

  if (art.kind === "hero" || art.kind === "poster") {
    return (
      <Image
        src={art.src}
        alt=""
        fill
        className={`object-cover transition-transform duration-300 group-hover:scale-105 ${art.kind === "poster" ? "object-top" : "object-center"}`}
        sizes="(max-width: 640px) 100vw, 640px"
        unoptimized
      />
    );
  }

  if (art.kind === "fighters") {
    return (
      <div className="absolute inset-0 flex bg-ink-950">
        {/* Red corner on the left; blue mirrored so the two face centre. */}
        <FighterHalf src={art.red} side="left" accent={accent} brand={brand} />
        <div className="z-10 w-px shrink-0 bg-gradient-to-b from-transparent via-blood-500/40 to-transparent" />
        <FighterHalf src={art.blue} side="right" accent={accent} brand={brand} />
      </div>
    );
  }

  return brand;
}

function FighterHalf({
  src, side, accent, brand,
}: { src: string | null; side: "left" | "right"; accent: string; brand: React.ReactNode }) {
  if (!src) {
    return (
      <div
        className="relative w-1/2 overflow-hidden"
        style={{ background: `linear-gradient(${side === "left" ? "105deg" : "255deg"}, color-mix(in srgb, ${accent} 35%, transparent), transparent 75%)` }}
      >
        {brand}
      </div>
    );
  }
  return (
    <div className="relative w-1/2 overflow-hidden">
      <Image
        src={src}
        alt=""
        fill
        className={`object-cover object-top transition-transform duration-300 group-hover:scale-105 ${side === "right" ? "scale-x-[-1]" : ""}`}
        sizes="(max-width: 640px) 50vw, 320px"
        unoptimized
      />
    </div>
  );
}
