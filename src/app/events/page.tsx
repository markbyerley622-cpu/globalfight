import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { EventFilters } from "@/components/events/event-filters";
import { EventCard } from "@/components/events/event-card";
import { Pager } from "@/components/pager";
import { queryEvents, getEventFacets, type EventFilters as Filters } from "@/lib/events-query";
import { getCurrentUser } from "@/lib/auth";
import { getFollowedEventIds } from "@/lib/follows";
import { getRecentEvents } from "@/lib/identity/recent-events";
import { RecentEvents } from "@/components/events/recent-events";
import { SPORT_BY_SLUG } from "@/lib/sports";
import { promotionBySlug } from "@/lib/promotions";

export const dynamic = "force-dynamic";

type SP = Promise<{ page?: string; sport?: string; promotion?: string; status?: string; country?: string; when?: string }>;

/** The status filter's own words, so the heading and the chip cannot disagree. */
const STATUS_HEADING: Record<string, string> = {
  upcoming: "Upcoming events",
  live: "Live now",
  completed: "Results",
  cancelled: "Cancelled & postponed",
};

/** Date-window headings, for when no status is chosen. */
const WHEN_HEADING: Record<string, string> = {
  week: "Next 7 days",
  month: "Next 30 days",
  quarter: "Next 90 days",
};

/**
 * Name the list the reader is actually looking at.
 *
 * Status wins over the date window, because "Results" and "Next 7 days" together
 * would need to read "Results in the next 7 days", which is nonsense — a result is
 * in the past. The promotion and sport are appended as context so a filtered view
 * announces itself ("UFC — upcoming events") instead of looking identical to the
 * unfiltered one.
 */
function listHeading(sp: Awaited<SP>): string {
  const base =
    (sp.status && STATUS_HEADING[sp.status]) ??
    (sp.when && WHEN_HEADING[sp.when]) ??
    "Upcoming events";

  const promo = sp.promotion ? promotionBySlug(sp.promotion)?.name : null;
  const sport = sp.sport ? SPORT_BY_SLUG[sp.sport]?.label : null;
  const qualifier = promo ?? sport;
  // Lower-cased when it follows a qualifier so it reads as one phrase.
  return qualifier ? `${qualifier} — ${base[0].toLowerCase()}${base.slice(1)}` : base;
}

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
  // "Recent events" leads the DEFAULT view only — not when someone is filtering
  // (status/promotion/sport/etc.) or paging, where it would fight the query.
  const isDefaultView = !sp.status && !sp.promotion && !sp.sport && !sp.country && !sp.when && filters.page === 0;
  const followed = viewer ? await getFollowedEventIds(viewer.id) : new Set<string>();
  const [{ events, total, page, pages }, facets, recentEvents] = await Promise.all([
    queryEvents(filters, followed),
    getEventFacets(filters),
    isDefaultView ? getRecentEvents(viewer?.id ?? null) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHero
        eyebrow="Every card that matters"
        title="Events"
        description="Upcoming fights with predictions, full cards, venues, broadcasters and live countdowns."
      />
      <div className="container-cr space-y-5 py-8">
        {recentEvents.length > 0 && <RecentEvents events={recentEvents} />}

        <EventFilters facets={facets} />

        {/* A HEADING for the list, not just a count. "129 events · page 1 of 11" told
            the reader how many rows there were but never what they were looking AT —
            and after filtering to results or to a promotion, the grid below is a
            different thing with identical framing.
            Derived from the active filter rather than hardcoded to "Upcoming
            events": a fixed label would be wrong the moment someone taps Results. */}
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-tight text-chalk">
            {listHeading(sp)}
          </h2>
          <p className="mt-0.5 text-xs text-fog">
            {total === 0 ? "No events match" : `${total.toLocaleString()} event${total === 1 ? "" : "s"}`}
            {pages > 1 && total > 0 ? ` · page ${page + 1} of ${pages}` : ""}
          </p>
        </div>

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
