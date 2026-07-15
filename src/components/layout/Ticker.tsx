import Link from "next/link";
import type { Event } from "@/lib/domain/types";
import { getFightById, getAthlete, getSportById } from "@/lib/data/store";

/**
 * Breaking-style marquee crawl, ported from Combat Register's Ticker. Surfaces
 * live + upcoming headline matchups across the current sport. Purely ambient —
 * every item links to its event.
 */
export function Ticker({ events }: { events: Event[] }) {
  const items = events
    .filter((e) => e.status === "live" || e.status === "scheduled" || e.status === "announced")
    .slice(0, 12)
    .map((event) => {
      const sport = getSportById(event.sportId);
      const headline = event.headlineFightId ? getFightById(event.headlineFightId) : undefined;
      const names = headline?.participants
        .map((p) => getAthlete(p.athleteId).name.split(" ").pop())
        .join(" vs ");
      return {
        key: event.id,
        tag: event.status === "live" ? "Live" : "Upcoming",
        live: event.status === "live",
        title: names ?? event.name,
        href: sport ? `/sports/${sport.slug}/events/${event.slug}` : "#",
      };
    });

  if (items.length === 0) return null;
  const doubled = [...items, ...items];

  return (
    <div className="border-b border-ink-800 bg-ink-900/80">
      <div className="flex items-center gap-3 overflow-hidden px-4 py-2">
        <span className="z-10 flex shrink-0 items-center gap-1.5 rounded bg-blood-500 px-2 py-1 font-display text-[0.62rem] font-bold uppercase tracking-wider text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-white" /> Fight wire
        </span>
        <div className="mask-fade-r relative flex-1 overflow-hidden">
          <div className="animate-marquee flex w-max items-center gap-8 whitespace-nowrap">
            {doubled.map((it, i) => (
              <Link key={`${it.key}-${i}`} href={it.href} className="flex items-center gap-2 text-xs">
                <span
                  className={`text-[0.6rem] font-bold uppercase tracking-wide ${
                    it.live ? "text-blood-400" : "text-volt-400"
                  }`}
                >
                  {it.tag}
                </span>
                <span className="font-semibold text-chalk">{it.title}</span>
                <span className="text-ink-600">•</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
