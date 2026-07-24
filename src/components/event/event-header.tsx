import Link from "next/link";
import { CalendarDays, MapPin, Radio, Building, Ticket } from "lucide-react";
import { resolveWatch, resolveTickets } from "@/lib/events/providers";
import type { FightEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { mapsUrl } from "@/lib/event-format";
import { resolvePoint } from "@/lib/geo/gazetteer";
import { Badge } from "@/components/ui/badge";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { resolvePromotion } from "@/lib/promotions";
import { FollowButton } from "@/components/follow-button";
import { ShareMenu } from "@/components/share-menu";
import { AddToCalendar } from "@/components/event/add-to-calendar";
import { BackButton } from "@/components/back-button";

/**
 * Top of the event destination. Frames the event and reflects lifecycle:
 * countdown (upcoming), live banner (live), completed marker (completed),
 * prominent status (cancelled/postponed).
 *
 * The action row (Follow · Add to calendar · Share) is the whole point of the
 * header for a returning fan: it is how an event leaves the app and lands in
 * the surfaces they already check.
 */
export function EventHeader({
  event, promotionFollowing, eventFollowing, boutCount,
}: {
  event: FightEvent;
  promotionFollowing?: boolean;
  eventFollowing?: boolean;
  boutCount?: number;
}) {
  const disrupted = event.status === "CANCELLED" || event.status === "POSTPONED";
  const isLive = event.status === "LIVE";
  const isCompleted = event.status === "COMPLETED";
  const location = [event.city, event.country].filter(Boolean).join(", ");
  const badgeTone = isLive ? "live" : isCompleted ? "neutral" : "red";
  const maps = mapsUrl(event);
  // Deep-link the venue into OUR map (the event is already plotted there),
  // geocoded from venue/city via the gazetteer. Google Maps drops to a secondary
  // "Directions" fallback rather than being the primary experience.
  const point = resolvePoint(event);
  // The location ALWAYS opens OUR map — focused on the venue when we can geocode
  // it, otherwise the map's default view. Never a third-party map as the primary.
  const inAppMap = point ? `/map?lat=${point.lat.toFixed(5)}&lon=${point.lon.toFixed(5)}&z=8` : "/map";
  // Where to watch / attend, resolved per-promotion (lib/events/providers) so the
  // detail page matches the card instead of hiding this behind a missing field.
  const watch = resolveWatch(event.promotion, event.broadcaster, null, event.name);
  const tickets = resolveTickets(event.promotion, null, event.name);
  // Resolve to the canonical org so we show a real name (never a raw "Various")
  // and only offer "follow" when it's an actual promotion, not the neutral mark.
  const org = resolvePromotion(event.promotion);
  const isRealOrg = org.slug !== "combat";

  return (
    <header
      className="relative overflow-hidden border-b border-ink-700/70 px-4 pb-5 pt-4"
      style={{
        backgroundImage:
          "radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--accent, #e11d2a) 14%, transparent), transparent 70%)",
      }}
    >
      {/* Leaf page: this sits outside the section tabs, so mobile needs an
          explicit way back to where the fan came from. */}
      <div className="relative mb-3">
        <BackButton fallback="/events" label="Back to events" />
      </div>

      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PromotionLogo promotion={event.promotion} size="md" />
          <p className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-blood-400">
            {org.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isRealOrg && (
            <FollowButton kind="promotion" slug={event.promotion!} name={event.promotion!} initialFollowing={promotionFollowing} size="sm" />
          )}
          <Badge tone={badgeTone}>
            {isLive && <span className="live-dot" aria-hidden />} {event.status}
          </Badge>
        </div>
      </div>

      {/* Event actions. Follow is first and loudest — it is the only one that
          brings the fan back on its own. Calendar/Share are for the card that
          matters enough to leave with them. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FollowButton
          kind="event"
          slug={event.slug}
          name={event.name}
          initialFollowing={eventFollowing}
          size="sm"
          label="Remind me"
        />
        {!isCompleted && (
          <AddToCalendar
            slug={event.slug}
            name={event.name}
            date={event.date}
            location={[event.venue, event.city, event.country].filter(Boolean).join(", ")}
            broadcaster={event.broadcaster}
            bouts={boutCount}
            size="sm"
          />
        )}
        <ShareMenu path={`/events/${event.slug}`} title={event.name} />
      </div>

      <h1 className="mt-1.5 font-display text-xl font-bold leading-tight text-chalk sm:text-2xl">
        {event.name}
      </h1>

      {/* Only surface what we actually know — no "TBA" filler. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Meta icon={<CalendarDays className="size-4" />} label="Date">
          {formatDate(event.date, { weekday: "long" })}
        </Meta>
        {event.venue && (
          <Meta icon={<Building className="size-4" />} label="Venue">
            {event.venue}
          </Meta>
        )}
        {location && (
          <Meta icon={<MapPin className="size-4" />} label="Location" className="col-span-2">
            {inAppMap ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* Primary: open the venue inside the in-app map. */}
                <Link
                  href={inAppMap}
                  className="inline-flex items-center gap-1.5 text-chalk underline decoration-ink-700 underline-offset-4 transition-colors hover:text-blood-300 hover:decoration-blood-400"
                >
                  {location} <Flag code={event.countryCode} />
                  <span className="text-[11px] font-medium text-blood-400">· View on map</span>
                </Link>
                {/* Secondary: external directions (final fallback). */}
                {maps && (
                  <a
                    href={maps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-fog underline decoration-ink-700 underline-offset-4 transition-colors hover:text-mist"
                  >
                    Directions ↗
                  </a>
                )}
              </span>
            ) : maps ? (
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-chalk underline decoration-ink-700 underline-offset-4 transition-colors hover:text-blood-300 hover:decoration-blood-400"
              >
                {location} <Flag code={event.countryCode} />
                <span className="text-[11px] font-medium text-blood-400">· Directions ↗</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {location} <Flag code={event.countryCode} />
              </span>
            )}
          </Meta>
        )}
        {watch && (
          <Meta icon={<Radio className="size-4" />} label="Watch">
            {watch.url ? (
              <a href={watch.url} target="_blank" rel="noopener noreferrer" className="text-chalk underline decoration-ink-700 underline-offset-4 transition-colors hover:text-blood-300 hover:decoration-blood-400">
                {watch.label} ↗
              </a>
            ) : watch.label}
          </Meta>
        )}
        {tickets && (
          <Meta icon={<Ticket className="size-4" />} label="Tickets">
            <a href={tickets.url} target="_blank" rel="noopener noreferrer" className="text-chalk underline decoration-ink-700 underline-offset-4 transition-colors hover:text-blood-300 hover:decoration-blood-400">
              {tickets.label === "Buy" ? "Buy tickets" : tickets.label} ↗
            </a>
          </Meta>
        )}
      </dl>

      {/* Lifecycle strip */}
      {disrupted ? (
        <div className="mt-4 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm text-gold-300">
          This event has been {event.status.toLowerCase()}. Details are retained for reference; a new
          date may be announced.
        </div>
      ) : isLive ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-sm font-medium text-blood-300">
          <span className="live-dot" aria-hidden /> Live now — bouts are updating in real time.
        </div>
      ) : isCompleted ? (
        <div className="mt-4 rounded-lg bg-ink-800 px-3 py-2 text-sm text-mist">
          This event is complete. Results and post-event coverage are below.
        </div>
      ) : null}
    </header>
  );
}

function Meta({
  icon,
  label,
  children,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-fog">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-sm font-bold text-chalk">{children}</dd>
    </div>
  );
}
