import type { Metadata } from "next";
import { MapExplorer } from "@/components/map/map-explorer";
import { getMapData } from "@/lib/geo/map-query";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Location — Events, Gyms & Fight Clubs",
  description:
    "The combat scene on a map. Find upcoming cards, partner gyms and fight clubs near you — anywhere in the world.",
  alternates: { canonical: "/map" },
};

export const dynamic = "force-dynamic";

/**
 * The Location pillar.
 *
 * Deliberately chrome-light: the map IS the page, so there is no PageHero
 * stealing the first screen. The header line is one row, then the filters and
 * the map take everything that's left.
 */
export default async function MapPage() {
  // The viewer decides what the People layer may even select — see people.ts.
  const user = await getCurrentUser().catch(() => null);
  const data = await getMapData(user?.id ?? null);

  return (
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col lg:h-[calc(100dvh-13rem)]">
      {/* The map is the product here, so the header is one line on a phone and
          only earns its subtitle where there is room to spare. */}
      <header className="shrink-0 px-4 pt-3 lg:pt-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-xl font-black uppercase tracking-tight text-chalk lg:text-2xl">
            Location
          </h1>
          <p className="font-display text-[0.62rem] font-bold uppercase tracking-[0.18em] text-blood-400">
            Explore &amp; discover
          </p>
        </div>
        <p className="mt-0.5 hidden max-w-lg text-sm text-fog sm:block">
          What&apos;s happening around you — upcoming cards, partner gyms and fight clubs. The map keeps growing.
        </p>
      </header>

      <div className="min-h-0 flex-1">
        <MapExplorer data={data} />
      </div>
    </div>
  );
}
