import { CalendarDays, Clock, MapPin, Radio } from "lucide-react";
import type { Event, Promotion, Venue } from "@/lib/domain/types";
import { formatEventDate, formatLocalTime } from "@/lib/domain/format";
import { EventStatusBadge } from "@/components/ui/EventStatusBadge";
import { Countdown } from "@/components/ui/Countdown";
import { LiveDot } from "@/components/ui/LiveDot";

/**
 * Top of the event destination. Frames the event and reflects lifecycle:
 * countdown (upcoming), live banner (live), completed marker (completed),
 * prominent status (cancelled/postponed).
 */
export function EventHeader({
  event,
  promotion,
  venue,
}: {
  event: Event;
  promotion?: Promotion;
  venue?: Venue;
}) {
  const disrupted = event.status === "cancelled" || event.status === "postponed";

  return (
    <header className="border-b border-border/70 px-4 pb-5 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-brand">
          {promotion?.name}
        </p>
        <EventStatusBadge status={event.status} />
      </div>

      <h1 className="mt-1.5 text-xl font-bold leading-tight sm:text-2xl">{event.name}</h1>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Meta icon={<CalendarDays className="h-4 w-4" />} label="Date">
          {formatEventDate(event.startsAt)}
        </Meta>
        {venue ? (
          <Meta icon={<Clock className="h-4 w-4" />} label="Start">
            {formatLocalTime(event.startsAt, venue.timezone)}
          </Meta>
        ) : null}
        {venue ? (
          <Meta icon={<MapPin className="h-4 w-4" />} label="Venue" className="col-span-2">
            {venue.name} · {venue.city}, {venue.country}
          </Meta>
        ) : null}
        {event.broadcasts[0] ? (
          <Meta icon={<Radio className="h-4 w-4" />} label="Broadcast" className="col-span-2">
            {event.broadcasts.map((b) => `${b.channel} (${b.region})`).join(" · ")}
          </Meta>
        ) : null}
      </dl>

      {/* Lifecycle strip */}
      {disrupted ? (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          This event has been {event.status}. Details are retained for reference; a new date may be
          announced.
        </div>
      ) : event.status === "live" ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-live/40 bg-live/10 px-3 py-2 text-sm font-medium text-live">
          <LiveDot /> Live now — bouts are updating in real time.
        </div>
      ) : event.status === "completed" ? (
        <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          This event is complete. Results and post-event coverage are below.
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2.5">
          <span className="text-xs uppercase tracking-wide text-faint">Event starts in</span>
          <Countdown target={event.startsAt} />
        </div>
      )}
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
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-fg">{children}</dd>
    </div>
  );
}
