import { CalendarDays, MapPin, Radio, Building } from "lucide-react";
import type { FightEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { Flag } from "@/components/flag";

/**
 * Top of the event destination. Frames the event and reflects lifecycle:
 * countdown (upcoming), live banner (live), completed marker (completed),
 * prominent status (cancelled/postponed).
 */
export function EventHeader({ event }: { event: FightEvent }) {
  const disrupted = event.status === "CANCELLED" || event.status === "POSTPONED";
  const isLive = event.status === "LIVE";
  const isCompleted = event.status === "COMPLETED";
  const location = [event.city, event.country].filter(Boolean).join(", ");
  const badgeTone = isLive ? "live" : isCompleted ? "neutral" : "red";

  return (
    <header className="border-b border-ink-700/70 px-4 pb-5 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-blood-400">
          {event.promotion ?? "Fight Card"}
        </p>
        <Badge tone={badgeTone}>
          {isLive && <span className="live-dot" aria-hidden />} {event.status}
        </Badge>
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
            <span className="inline-flex items-center gap-1.5">
              {location} <Flag code={event.countryCode} />
            </span>
          </Meta>
        )}
        {event.broadcaster && (
          <Meta icon={<Radio className="size-4" />} label="Broadcast" className="col-span-2">
            {event.broadcaster}
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
      ) : (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2.5">
          <span className="text-xs uppercase tracking-wide text-fog">Event starts in</span>
          <Countdown date={event.date} compact />
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
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-fog">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-sm font-bold text-chalk">{children}</dd>
    </div>
  );
}
