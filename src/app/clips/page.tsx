import type { Metadata } from "next";
import { Video } from "lucide-react";
import { listRecentVideos, videoFacets } from "@/lib/feed/repo";
// SPORT_BY_SLUG and promotionBySlug, NOT the client-only SPORT_PILLS: importing
// a "use client" module from a server component yields the client reference
// proxy, not the array — which 500s the page the moment you call .find on it.
import { promotionBySlug } from "@/lib/promotions";
import { SPORT_BY_SLUG } from "@/lib/sports";
import { VideoGrid } from "@/components/feed/video-grid";
import { Chip, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Watch",
  description: "The latest video from every promotion and discipline — official channels only.",
};

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  /clips — the browse surface for trusted video.
//
//  This route used to render a user-upload reel over a Clip table that had
//  never held a single row and was linked from nowhere. The upload path is
//  gone (lib/clips, components/clips and /api/clips are all deleted); the URL
//  is kept because it is the one that may already be shared.
//
//  Newest first, filtered by the SAME promotion and discipline vocabularies as
//  the rest of the app, and the chips are built from what the catalog actually
//  holds — a filter that returns "nothing here" is a filter that should never
//  have been offered.
// ════════════════════════════════════════════════════════════════════════════

export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ promotion?: string; sport?: string }>;
}) {
  const sp = await searchParams;
  const facets = await videoFacets();

  const promotion = facets.promotions.includes(sp.promotion ?? "") ? sp.promotion! : null;
  const discipline = facets.disciplines.includes(sp.sport ?? "") ? sp.sport! : null;
  const videos = await listRecentVideos({ promotion, discipline });

  const href = (patch: { promotion?: string | null; sport?: string | null }) => {
    const p = patch.promotion === undefined ? promotion : patch.promotion;
    const s = patch.sport === undefined ? discipline : patch.sport;
    const q = new URLSearchParams();
    if (p) q.set("promotion", p);
    if (s) q.set("sport", s);
    const qs = q.toString();
    return qs ? `/clips?${qs}` : "/clips";
  };

  const sportLabel = (slug: string) => SPORT_BY_SLUG[slug]?.label ?? slug;

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4">
          <p className="eyebrow">Straight from the source</p>
          <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">Watch</h1>
          <p className="mt-1 text-sm text-fog">
            The latest from official promotion channels and the analysts worth watching. Newest first.
          </p>
        </header>

        {facets.promotions.length > 0 && (
          <ChipRow className="mb-2">
            <Chip href={href({ promotion: null })} active={!promotion}>All promotions</Chip>
            {facets.promotions.map((slug) => (
              <Chip key={slug} href={href({ promotion: slug })} active={promotion === slug}>
                {promotionBySlug(slug)?.name ?? slug}
              </Chip>
            ))}
          </ChipRow>
        )}

        {facets.disciplines.length > 0 && (
          <ChipRow className="mb-4">
            <Chip href={href({ sport: null })} active={!discipline}>All disciplines</Chip>
            {facets.disciplines.map((slug) => (
              <Chip key={slug} href={href({ sport: slug })} active={discipline === slug}>
                {sportLabel(slug)}
              </Chip>
            ))}
          </ChipRow>
        )}

        {videos.length === 0 ? (
          <EmptyState
            icon={<Video className="size-5 text-blood-400" />}
            title="No video yet"
            body="Nothing has published on the channels we follow for this filter. The catalog refreshes hourly."
            action={{ href: "/clips", label: "Show everything" }}
          />
        ) : (
          <VideoGrid videos={videos} />
        )}
      </div>
    </div>
  );
}
