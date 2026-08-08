"use client";

import { CalendarDays, Dumbbell, MapPin, Navigation } from "lucide-react";
import { registerPreview, str, num, bool, list, type PreviewViewProps } from "./registry";
import { PreviewActions, PreviewAction, PreviewFact, PreviewHeader, PreviewStats } from "./parts";

// ════════════════════════════════════════════════════════════════════════════
//  A GYM.
// ════════════════════════════════════════════════════════════════════════════

function GymPreview({ preview }: PreviewViewProps) {
  const slug = str(preview.slug);
  const name = str(preview.name) ?? "Gym";
  const city = str(preview.city);
  const country = str(preview.country);
  const place = [city, country].filter(Boolean).join(", ");
  const directions = str(preview.directionsUrl);
  const disciplines = list(preview.disciplines).filter((d): d is string => typeof d === "string");
  const upcoming = num(preview.upcomingEvents);

  return (
    <div className="p-3">
      <PreviewHeader
        imageUrl={str(preview.logoUrl)}
        name={name}
        subtitle={disciplines.length > 0 ? disciplines.slice(0, 3).join(" · ") : null}
        verified={bool(preview.verified)}
        fallback={<Dumbbell className="size-4 text-fog" aria-hidden />}
      />

      {place && <PreviewFact icon={MapPin}>{place}</PreviewFact>}

      {/* Only when there is something to say. "0 upcoming" on a gym that simply
          does not run events reads as a broken counter rather than as a fact. */}
      {upcoming !== null && upcoming > 0 && (
        <PreviewFact icon={CalendarDays}>
          {upcoming} upcoming event{upcoming === 1 ? "" : "s"}
        </PreviewFact>
      )}

      <PreviewStats stats={[{ label: "Members", value: num(preview.memberCount) }]} />

      <PreviewActions>
        {slug && (
          <PreviewAction href={`/gyms/${slug}`} primary focusTarget>
            Open gym
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

registerPreview("gym", GymPreview);

export { GymPreview };
