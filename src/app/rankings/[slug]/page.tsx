import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { RankingList } from "@/components/ranking-list";
import { getRankingBySlug } from "@/lib/repo";
import { WEIGHT_CLASS_LIST } from "@/lib/repo";
import { formatDate } from "@/lib/utils";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

export function generateStaticParams() {
  return WEIGHT_CLASS_LIST.map((w) => ({ slug: w.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await getRankingBySlug(slug);
  if (!r) return {};
  return {
    title: `${r.weightClass} Rankings`,
    description: `Live ${r.weightClass} boxing rankings with movement and ratings, from verified records.`,
  };
}

export const revalidate = 300;

export default async function DivisionPage({ params }: { params: Promise<{ slug: string }> }) {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().rankingsEnabled) {
    return <FeatureUnavailable title="Rankings" reason="Rankings are not available. Our existing ranking data could not be traced to a licensed source, so it has been withdrawn. Rankings will return when a licensed source is in place." />;
  }
  const { slug } = await params;
  const ranking = await getRankingBySlug(slug);
  if (!ranking) notFound();

  return (
    <>
      <PageHero
        eyebrow="Divisional Rankings"
        title={ranking.weightClass}
        description={`Top contenders at ${ranking.weightClass}. Last updated ${formatDate(ranking.updatedAt)}.`}
      >
        <div className="flex flex-wrap gap-2">
          {WEIGHT_CLASS_LIST.map((w) => (
            <Link
              key={w.slug}
              href={`/rankings/${w.slug}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                w.slug === slug
                  ? "border-blood-500 bg-blood-500/15 text-blood-300"
                  : "border-ink-700 bg-ink-900/60 text-mist hover:border-blood-500/50 hover:text-chalk"
              }`}
            >
              {w.name}
            </Link>
          ))}
        </div>
      </PageHero>

      <div className="container-cr py-10">
        <div className="mx-auto max-w-3xl card-surface overflow-hidden">
          <div className="grid grid-cols-[2rem_2rem_1fr_auto] items-center gap-3 border-b border-ink-700 px-4 py-2.5 text-[0.65rem] font-semibold uppercase tracking-wider text-fog">
            <span>#</span><span></span><span>Fighter</span><span>Rating</span>
          </div>
          {ranking.rankings.length > 0 ? (
            <RankingList ranking={ranking} />
          ) : (
            <p className="px-4 py-10 text-center text-sm text-fog">No rankings available for this division yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
