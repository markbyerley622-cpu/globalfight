import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { promotionLabel } from "@/lib/promotions";
import type { getUpcomingEvents } from "@/lib/repo";

type UpcomingEvent = Awaited<ReturnType<typeof getUpcomingEvents>>[number];

// Live pulse dot — CR blood accent.
function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-blood-500 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-blood-500" />
    </span>
  );
}

/**
 * Compact event card for the discovery timeline (globalfight /sports layout,
 * CR palette). Tapping anywhere opens the event. Adapts to lifecycle: countdown
 * for upcoming, live pulse for live.
 */
export function DiscoveryEventCard({ event }: { event: UpcomingEvent }) {
  const main = event.fights.find((f) => f.mainEvent) ?? event.fights[0];
  const isLive = event.status === "LIVE";
  const isCompleted = event.status === "COMPLETED";
  const isUpcoming = !isLive && !isCompleted;
  const location = [event.venue, event.city, event.country].filter(Boolean).join(", ");

  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        "card-surface block p-3.5 transition-all",
        "hover:border-blood-500/50 hover:shadow-[0_10px_40px_-16px_rgba(225,29,42,0.45)]",
      )}
    >
      {/* Meta row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <PromotionLogo promotion={event.promotion} size="sm" />
          <span className="min-w-0 truncate text-xs font-medium text-mist">{promotionLabel(event.promotion)}</span>
        </div>
        <Badge tone={isLive ? "red" : "neutral"}>{event.status}</Badge>
      </div>

      {/* Event name */}
      <h3 className="mt-2 font-display text-[15px] font-semibold leading-snug text-chalk">{event.name}</h3>

      {/* Headline matchup */}
      {main && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FighterAvatar fighter={main.red} size="sm" />
            <p className="truncate text-sm font-medium text-chalk">{main.red.name}</p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-fog">vs</span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
            <p className="truncate text-sm font-medium text-chalk">{main.blue.name}</p>
            <FighterAvatar fighter={main.blue} size="sm" />
          </div>
        </div>
      )}

      {/* Lifecycle strip */}
      {isLive ? (
        <p className="mt-3 flex items-center gap-2 text-xs font-medium text-blood-400">
          <LiveDot /> Happening now
        </p>
      ) : isUpcoming ? (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-fog">Starts in</span>
          <Countdown date={event.date} compact />
        </div>
      ) : null}

      {/* Footer meta */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fog">
        <span>{formatDate(event.date, { weekday: "short" })}</span>
        {location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" /> {location} <Flag code={event.countryCode} />
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" /> {event.fights.length} bouts
        </span>
      </div>
    </Link>
  );
}
