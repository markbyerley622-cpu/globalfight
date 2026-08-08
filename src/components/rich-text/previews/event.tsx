"use client";

import { CalendarDays, MapPin, Navigation, Swords } from "lucide-react";
import { registerPreview, str, num, type PreviewViewProps } from "./registry";
import { PreviewActions, PreviewAction, PreviewFact, PreviewHeader, PreviewStats } from "./parts";

// ════════════════════════════════════════════════════════════════════════════
//  AN EVENT.
//
//  ── Why the countdown is a sentence, not the map card's digit block ───────
//  EventMapPreview renders a three-cell HH:MM:SS countdown on a 1Hz clock. That
//  is right for a card somebody opened deliberately on a map they are studying;
//  it is wrong here. A hover card can be open for two seconds, and subscribing
//  it to a per-second tick means a re-render every second for a number nobody
//  read — on a feed where the pointer crosses a dozen chips, that is a dozen
//  intervals started and stopped.
//
//  So the distance to the event is computed ONCE, at render, in words. It is
//  the same information at the resolution this surface can actually use.
// ════════════════════════════════════════════════════════════════════════════

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
});

/**
 * "In 3 days", "Tomorrow", "Sat, 8 Aug 2026".
 *
 * Computed from a date the SERVER sent, against the client's clock. The two can
 * disagree by a few seconds; nothing here is precise enough for that to show.
 */
function whenLabel(iso: string): { text: string; soon: boolean } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: "Date to be confirmed", soon: false };
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < -1) return { text: DATE_FMT.format(d), soon: false };
  if (days < 0) return { text: "Yesterday", soon: false };
  if (days === 0) return { text: "Today", soon: true };
  if (days === 1) return { text: "Tomorrow", soon: true };
  if (days <= 14) return { text: `In ${days} days`, soon: days <= 7 };
  return { text: DATE_FMT.format(d), soon: false };
}

function EventPreview({ preview }: PreviewViewProps) {
  const slug = str(preview.slug);
  const name = str(preview.name) ?? "Event";
  const date = str(preview.date);
  const when = date ? whenLabel(date) : null;
  const venue = str(preview.venue);
  const city = str(preview.city);
  const main = preview.mainEvent as { red?: unknown; blue?: unknown } | null | undefined;
  const red = str(main?.red);
  const blue = str(main?.blue);
  const directions = str(preview.directionsUrl);

  return (
    <div className="p-3">
      <PreviewHeader
        imageUrl={str(preview.posterUrl)}
        name={name}
        subtitle={str(preview.promotion)}
        fallback={<CalendarDays className="size-4 text-fog" aria-hidden />}
      />

      {when && (
        <PreviewFact icon={CalendarDays}>
          <span className={when.soon ? "font-semibold text-blood-300" : undefined}>{when.text}</span>
          {date && when.text !== DATE_FMT.format(new Date(date)) && (
            <span className="text-fog"> · {DATE_FMT.format(new Date(date))}</span>
          )}
        </PreviewFact>
      )}

      {red && blue && (
        <PreviewFact icon={Swords}>
          <span className="font-semibold text-chalk">{red}</span>
          <span className="text-blood-400"> vs </span>
          <span className="font-semibold text-chalk">{blue}</span>
        </PreviewFact>
      )}

      {(venue || city) && (
        <PreviewFact icon={MapPin}>
          {venue ?? city}
          {venue && city && <span className="text-fog"> · {city}</span>}
        </PreviewFact>
      )}

      <PreviewStats
        stats={[
          { label: "Following", value: num(preview.followers) },
          { label: "Picks", value: num(preview.predictions) },
        ]}
      />

      <PreviewActions>
        {slug && (
          <PreviewAction href={`/events/${slug}`} primary focusTarget>
            Open event
          </PreviewAction>
        )}
        {directions && (
          <PreviewAction href={directions} external focusTarget={!slug}>
            <Navigation className="size-3" aria-hidden /> Directions
          </PreviewAction>
        )}
      </PreviewActions>
    </div>
  );
}

registerPreview("event", EventPreview);

export { EventPreview };
