import { CalendarX } from "lucide-react";
import type { Event } from "@/lib/domain/types";
import { groupEventsByTime } from "@/lib/domain/selectors";
import { LiveDot } from "@/components/ui/LiveDot";
import { EmptyState } from "@/components/ui/EmptyState";
import { EventCard } from "./EventCard";

/**
 * The event discovery screen body: events for the selected sport grouped by
 * time bucket (Live now, Coming up, Next 7 days, Later, Recently completed).
 * A focused directory — not the full event experience.
 */
export function EventTimeline({ events, sportName }: { events: Event[]; sportName: string }) {
  const groups = groupEventsByTime(events);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CalendarX className="h-6 w-6" />}
        title={`No ${sportName} events yet`}
        description="There's nothing on the schedule for this sport right now. Check back soon or switch sports above."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.bucket} aria-labelledby={`grp-${group.bucket}`}>
          <div className="mb-2.5 flex items-center gap-2">
            {group.bucket === "live" ? <LiveDot /> : null}
            <h2 id={`grp-${group.bucket}`} className="eyebrow">
              {group.label}
            </h2>
            <span className="text-xs tabular-nums text-fog">({group.events.length})</span>
          </div>
          <div className="flex flex-col gap-3">
            {group.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
