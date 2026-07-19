import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Tv } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { SportFilter } from "@/components/sport-filter";
import { FighterAvatar } from "@/components/fighter-avatar";
import { getUpcomingEvents } from "@/lib/repo";
import { SPORT_BY_SLUG } from "@/lib/sports";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { promotionLabel } from "@/lib/promotions";
import { Pager } from "@/components/pager";
import { getServerT } from "@/lib/i18n-server";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Events",
  description: "Upcoming combat-sports events and fight cards — predictions, venues, broadcasters and countdowns. Filter by sport.",
};

export const dynamic = "force-dynamic";
const PER_PAGE = 5;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ page?: string; sport?: string }> }) {
  const { page: pageStr, sport: sportSlug } = await searchParams;
  const sportValue = sportSlug ? SPORT_BY_SLUG[sportSlug]?.value : undefined;
  const page = Math.max(0, Number(pageStr) - 1) || 0;
  const allEvents = await getUpcomingEvents();
  const all = sportValue ? allEvents.filter((e) => e.sport === sportValue) : allEvents;
  const events = all.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const t = await getServerT();
  return (
    <>
      <PageHero
        eyebrow="Every card that matters"
        title="Events"
        description="Upcoming fights with predictions, full cards, venues, broadcasters and live countdowns."
      />
      <div className="container-cr space-y-4 py-10">
        <SportFilter />
        {events.map((e) => {
          return (
            <div key={e.id} className="card-surface overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-ink-700 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PromotionLogo promotion={e.promotion} size="sm" />
                    <Badge tone={e.status === "ANNOUNCED" ? "neutral" : "red"}>{e.status}</Badge>
                    <span className="text-xs text-fog">{promotionLabel(e.promotion)}</span>
                  </div>
                  <h2 className="mt-1.5 font-display text-2xl font-bold text-chalk">{e.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist">
                    <span>{formatDate(e.date, { weekday: "long" })}</span>
                    {[e.venue, e.city, e.country].some(Boolean) && (
                      <span className="flex items-center gap-1.5"><MapPin className="size-3.5 text-blood-400" />{[e.venue, e.city, e.country].filter(Boolean).join(", ")} <Flag code={e.countryCode} /></span>
                    )}
                    {e.broadcaster && <span className="flex items-center gap-1.5"><Tv className="size-3.5 text-blood-400" />{e.broadcaster}</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-ink-700 bg-ink-950/40 px-4 py-3 text-center">
                  <p className="mb-1 text-[0.6rem] uppercase tracking-widest text-fog">{t("First bell")}</p>
                  <Countdown date={e.date} compact />
                </div>
              </div>
              <div className="divide-y divide-ink-800">
                {e.fights.map((f) => (
                  <Link key={f.id} href={`/predictions/${f.slug}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-800/50">
                    <span className="flex min-w-0 items-center gap-2">
                      {f.mainEvent && <Badge tone="red">{t("Main")}</Badge>}
                      {f.coMain && <Badge tone="neutral">{t("Co-Main")}</Badge>}
                      <span className="flex items-center gap-2">
                        <FighterAvatar fighter={f.red} size="sm" />
                        <span className="font-display text-sm font-semibold text-chalk">{f.red.name}</span>
                      </span>
                      <span className="text-xs font-bold text-fog">vs</span>
                      <span className="flex items-center gap-2">
                        <FighterAvatar fighter={f.blue} size="sm" />
                        <span className="font-display text-sm font-semibold text-chalk">{f.blue.name}</span>
                      </span>
                    </span>
                    {f.weightClass && <span className="shrink-0 text-xs text-fog">{f.weightClass}</span>}
                  </Link>
                ))}
              </div>
              <Link href={`/events/${e.slug}`} className="block border-t border-ink-700 px-5 py-3 text-center font-display text-xs font-semibold uppercase tracking-wide text-blood-400 hover:bg-ink-800/50">
                {t("Full card & previews")}
              </Link>
            </div>
          );
        })}
        {events.length === 0 && (
          <p className="card-surface p-10 text-center text-sm text-fog">{t("No upcoming events scheduled.")}</p>
        )}
        <Pager page={page} hasNext={(page + 1) * PER_PAGE < all.length} />
      </div>
    </>
  );
}
