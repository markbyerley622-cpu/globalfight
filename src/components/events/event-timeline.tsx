import { CalendarX } from "lucide-react";
import { groupEventsByTime } from "@/lib/event-buckets";
import { DiscoveryEventCard } from "./discovery-event-card";
import type { getUpcomingEvents } from "@/lib/repo";

type UpcomingEvent = Awaited<ReturnType<typeof getUpcomingEvents>>[number];

/**
 * Event-discovery body: events grouped by time bucket (Live now, Coming up,
 * Next 7 days, Later, Recently completed) — the globalfight /sports layout.
 */
export function EventTimeline({ events, sportName }: { events: UpcomingEvent[]; sportName: string }) {
  const groups = groupEventsByTime(events);

  if (groups.length === 0) {
    return (
      <div className="card-surface flex flex-col items-center gap-2 p-10 text-center">
        <CalendarX className="size-6 text-fog" />
        <p className="font-display text-sm font-semibold text-chalk">No {sportName} events yet</p>
        <p className="max-w-xs text-xs text-fog">
          Nothing on the schedule right now. Switch sports above or check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.bucket}>
          <div className="mb-2.5 flex items-center gap-2">
            {group.bucket === "live" && (
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-blood-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-blood-500" />
              </span>
            )}
            <h2 className="font-display text-xs font-bold uppercase tracking-widest text-fog">{group.label}</h2>
            <span className="text-xs tabular-nums text-fog">({group.events.length})</span>
          </div>
          <div className="flex flex-col gap-3">
            {group.events.map((event) => (
              <DiscoveryEventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
