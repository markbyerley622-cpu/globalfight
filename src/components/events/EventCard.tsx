import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/domain/types";
import {
  getFightById,
  getPromotion,
  getResult,
  getSportById,
  getAthlete,
  getVenue,
} from "@/lib/data/store";
import { getSportRules, methodLabel } from "@/lib/domain/sportRules";
import { formatEventDate, formatLocalTime, formatRecord } from "@/lib/domain/format";
import { EventStatusBadge } from "@/components/ui/EventStatusBadge";
import { FighterAvatar } from "@/components/ui/FighterAvatar";
import { Countdown } from "@/components/ui/Countdown";
import { LiveDot } from "@/components/ui/LiveDot";

/**
 * Compact event card for the discovery timeline. Selecting anywhere on the card
 * opens the event destination. Content adapts to lifecycle: countdown for
 * upcoming, live indicator for live, result summary for completed.
 */
export function EventCard({ event }: { event: Event }) {
  const sport = getSportById(event.sportId);
  const promotion = getPromotion(event.promotionId);
  const venue = getVenue(event.venueId);
  const headline = event.headlineFightId ? getFightById(event.headlineFightId) : undefined;
  const rules = sport ? getSportRules(sport.slug) : undefined;

  const red = headline?.participants.find((p) => p.corner === "red");
  const blue = headline?.participants.find((p) => p.corner === "blue");
  const redAthlete = red ? getAthlete(red.athleteId) : undefined;
  const blueAthlete = blue ? getAthlete(blue.athleteId) : undefined;
  const result = headline ? getResult(headline.id) : undefined;

  const href = sport ? `/sports/${sport.slug}/events/${event.slug}` : "#";
  const isUpcoming = event.status === "scheduled" || event.status === "announced";

  return (
    <Link
      href={href}
      className={cn(
        "card-surface block p-3.5 transition-all hover:border-blood-500/50 hover:shadow-[0_10px_40px_-16px_rgba(225,29,42,0.45)]",
        "focus-visible:border-brand",
      )}
    >
      {/* Meta row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="truncate font-medium text-fg">{promotion?.shortName}</span>
          {headline?.titleFight ? (
            <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
              TITLE
            </span>
          ) : null}
        </div>
        <EventStatusBadge status={event.status} />
      </div>

      {/* Event name */}
      <h3 className="mt-2 text-[15px] font-semibold leading-snug">{event.name}</h3>

      {/* Headline matchup */}
      {redAthlete && blueAthlete ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2">
            <FighterAvatar athlete={redAthlete} size="sm" corner="red" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{redAthlete.name}</p>
              <p className="text-[11px] text-faint tabular-nums">{formatRecord(redAthlete.record)}</p>
            </div>
          </div>
          <span className="text-xs font-semibold text-faint">vs</span>
          <div className="flex flex-1 items-center justify-end gap-2 text-right">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{blueAthlete.name}</p>
              <p className="text-[11px] text-faint tabular-nums">{formatRecord(blueAthlete.record)}</p>
            </div>
            <FighterAvatar athlete={blueAthlete} size="sm" corner="blue" />
          </div>
        </div>
      ) : null}

      {/* Result / countdown strip */}
      {event.status === "completed" && result ? (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          {result.winnerCorner
            ? `${result.winnerCorner === "red" ? redAthlete?.name : blueAthlete?.name} def. ${result.winnerCorner === "red" ? blueAthlete?.name : redAthlete?.name}`
            : "Draw"}
          {" · "}
          <span className="text-fg">{methodLabel(result.method)}</span>
          {result.endRound ? ` · R${result.endRound}` : ""}
        </p>
      ) : event.status === "live" ? (
        <p className="mt-3 flex items-center gap-2 text-xs font-medium text-live">
          <LiveDot /> Happening now
        </p>
      ) : isUpcoming ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-faint">Starts in</span>
          <Countdown target={event.startsAt} compact className="text-xs font-semibold text-fg" />
        </div>
      ) : null}

      {/* Footer meta */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>{formatEventDate(event.startsAt)}</span>
        {venue ? (
          <span>· {formatLocalTime(event.startsAt, venue.timezone)}</span>
        ) : null}
        {venue ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {venue.city}, {venue.country}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" /> {event.fightIds.length} {rules?.contestNounPlural.toLowerCase() ?? "bouts"}
        </span>
      </div>
    </Link>
  );
}
