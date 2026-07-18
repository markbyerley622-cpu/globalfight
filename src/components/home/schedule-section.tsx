import Link from "next/link";
import { MapPin, Tv, Calendar } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { getUpcomingEvents } from "@/lib/repo";
import { formatDate } from "@/lib/utils";

export async function ScheduleSection() {
  const events = (await getUpcomingEvents()).slice(0, 4);

  return (
    <section className="border-y border-ink-800 bg-ink-900/40 py-12">
      <div className="container-cr">
        <SectionHeading eyebrow="Don't miss a bell" title="Upcoming Schedule" href="/schedule" />
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((e) => {
            const main = e.fights.find((f) => f.mainEvent) ?? e.fights[0];
            return (
              <Link
                key={e.id}
                href={`/schedule/${e.slug}`}
                className="group card-surface flex flex-col gap-4 p-5 transition-all hover:border-blood-500/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <PromotionLogo promotion={e.promotion} size="sm" />
                    {e.status === "ANNOUNCED" ? <Badge tone="neutral">Announced</Badge> : <Badge tone="red">On sale</Badge>}
                    {main?.titleFight && <Badge tone="gold">Title Fight</Badge>}
                  </div>
                  <h3 className="mt-2 font-display text-xl font-bold text-chalk transition-colors group-hover:text-blood-300">
                    {main ? `${main.red.name} vs ${main.blue.name}` : e.name}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist">
                    <span className="flex items-center gap-1.5"><Calendar className="size-3.5 text-blood-400" />{formatDate(e.date, { weekday: "short" })}</span>
                    {[e.venue, e.city, e.country].some(Boolean) && (
                      <span className="flex items-center gap-1.5"><MapPin className="size-3.5 text-blood-400" />{[e.venue, e.city, e.country].filter(Boolean).join(", ")} <Flag code={e.countryCode} /></span>
                    )}
                    {e.broadcaster && <span className="flex items-center gap-1.5"><Tv className="size-3.5 text-blood-400" />{e.broadcaster}</span>}
                  </div>
                </div>
                <div className="shrink-0 rounded-lg border border-ink-700 bg-ink-950/40 px-4 py-3 text-center">
                  <p className="mb-1 text-[0.6rem] uppercase tracking-widest text-fog">First bell in</p>
                  <Countdown date={e.date} compact />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
