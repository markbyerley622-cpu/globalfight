import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { EventFilters } from "@/components/events/event-filters";
import { EventCard } from "@/components/events/event-card";
import { Pager } from "@/components/pager";
import { queryEvents, getEventFacets, type EventFilters as Filters } from "@/lib/events-query";
import { getCurrentUser } from "@/lib/auth";
import { getFollowedEventIds } from "@/lib/follows";
import { SPORT_BY_SLUG } from "@/lib/sports";
import { promotionBySlug } from "@/lib/promotions";

export const dynamic = "force-dynamic";

type SP = Promise<{ page?: string; sport?: string; promotion?: string; status?: string; country?: string; when?: string }>;

/** Every filter combination gets its own honest title/description, so a shared
 *  or indexed URL describes what it actually shows. */
export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const p = await searchParams;
  const sport = p.sport ? SPORT_BY_SLUG[p.sport]?.label : null;
  const promo = p.promotion ? promotionBySlug(p.promotion)?.name : null;
  const status = p.status === "completed" ? "Results" : p.status === "live" ? "Live events" : "Events";
  const bits = [promo, sport, status].filter(Boolean);
  const title = bits.length > 1 ? bits.join(" · ") : "Events";
  return {
    title,
    description: `${[promo, sport].filter(Boolean).join(" ")} combat-sports ${p.status === "completed" ? "results" : "events"} — full fight cards, venues, broadcasters, countdowns and predictions.`.replace(/\s+/g, " ").trim(),
  };
}

export default async function EventsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters: Filters = {
    sport: sp.sport, promotion: sp.promotion, status: sp.status, country: sp.country, when: sp.when,
    page: Math.max(0, Number(sp.page) - 1) || 0,
  };

  const viewer = await getCurrentUser();
  const followed = viewer ? await getFollowedEventIds(viewer.id) : new Set<string>();
  const [{ events, total, page, pages }, facets] = await Promise.all([
    queryEvents(filters, followed),
    getEventFacets(filters),
  ]);

  return (
    <>
      <PageHero
        eyebrow="Every card that matters"
        title="Events"
        description="Upcoming fights with predictions, full cards, venues, broadcasters and live countdowns."
      />
      <div className="container-cr space-y-5 py-8">
        <EventFilters facets={facets} />

        <p className="text-xs text-fog">
          {total === 0 ? "No events match" : `${total.toLocaleString()} event${total === 1 ? "" : "s"}`}
          {pages > 1 && total > 0 ? ` · page ${page + 1} of ${pages}` : ""}
        </p>

        {events.length === 0 ? (
          <div className="card-surface p-10 text-center">
            <p className="font-display text-base font-bold text-chalk">Nothing here</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-fog">
              No events match these filters. Try a wider date window, or clear a filter above.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {events.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}

        <Pager page={page} hasNext={page + 1 < pages} />
      </div>
    </>
  );
}
