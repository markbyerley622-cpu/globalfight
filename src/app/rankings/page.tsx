import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHero } from "@/components/page-hero";
import { RankingList } from "@/components/ranking-list";
import { SportFilter } from "@/components/sport-filter";
import { Pager } from "@/components/pager";
import { FighterAvatar } from "@/components/fighter-avatar";
import { MovementIndicator } from "@/components/ui/badge";
import { Flag } from "@/components/flag";
import { getRankingDivisionsSafe, getPoundForPoundPage } from "@/lib/repo";
import { SampleDataNote } from "@/components/sample-data-note";
import { SPORT_BY_SLUG, SPORT_LABEL } from "@/lib/sports";
import { getServerT } from "@/lib/i18n-server";
import { formatRecord } from "@/lib/utils";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

export const metadata: Metadata = {
  title: "Rankings — All Combat Sports",
  description: "Combat-sports divisional rankings in one place. Filter by sport for weight-class rankings and top-rated fighters.",
};

export const dynamic = "force-dynamic";
const LIMIT = 10;
const DIV_PER_PAGE = 9;          // divisions per page (e.g. kickboxing has dozens)
const PER_DIVISION = 9;          // ranked fighters shown per division

export default async function RankingsPage({ searchParams }: { searchParams: Promise<{ sport?: string; page?: string }> }) {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().rankingsEnabled) {
    return <FeatureUnavailable title="Rankings" reason="Rankings are not available. Our existing ranking data could not be traced to a licensed source, so it has been withdrawn. Rankings will return when a licensed source is in place." />;
  }
  const { sport: sportSlug, page: pageStr } = await searchParams;
  // No "All Sports" on rankings — default to MMA so the page always serves a sport.
  if (!sportSlug) redirect("/rankings?sport=mma");
  const sportEntry = SPORT_BY_SLUG[sportSlug];
  const sportValue = sportEntry?.value ?? "MMA";
  const sportLabel = SPORT_LABEL[sportValue] ?? "MMA";
  const page = Math.max(0, Number(pageStr) - 1) || 0;

  const { data: allDivisions, usedFallback: divFallback } = await getRankingDivisionsSafe(sportValue);
  const t = await getServerT();
  const divisions = allDivisions.slice(page * DIV_PER_PAGE, page * DIV_PER_PAGE + DIV_PER_PAGE);
  const list = allDivisions.length === 0 ? await getPoundForPoundPage(sportValue, page, LIMIT) : null;
  const showSampleNote = (divFallback && allDivisions.length > 0) || (!!list?.usedFallback && list.items.length > 0);

  return (
    <>
      <PageHero
        eyebrow="Divisional rankings"
        title="Rankings"
        description="Weight-class rankings and top-rated fighters — by sport, all in one place."
      />

      <div className="container-cr py-8">
        <SportFilter />

        {showSampleNote && <SampleDataNote className="mt-6" />}

        {/* Rankings body */}
        <section className="mt-8">
          {allDivisions.length > 0 ? (
            <>
              <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-fog">{sportLabel} {t("Divisions")}</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {divisions.map((w) => (
                  <div key={w.slug} className="card-surface overflow-hidden">
                    <Link href={`/rankings/${w.slug}`} className="flex items-center justify-between border-b border-ink-700 px-4 py-3 hover:bg-ink-800/50">
                      <span className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{w.name}</span>
                      <span className="text-[0.65rem] uppercase tracking-wider text-fog">{w.limitLbs ? `${w.limitLbs} lbs` : "No limit"}</span>
                    </Link>
                    {w.rankings.length > 0 ? (
                      <RankingList ranking={{ weightClass: w.name, slug: w.slug, isPoundForPound: false, rankings: w.rankings, updatedAt: new Date().toISOString() }} limit={PER_DIVISION} dense />
                    ) : (
                      <p className="px-4 py-6 text-center text-xs text-fog">{t("No rankings available yet for this division.")}</p>
                    )}
                  </div>
                ))}
              </div>
              <Pager page={page} hasNext={(page + 1) * DIV_PER_PAGE < allDivisions.length} />
            </>
          ) : list && list.items.length > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-fog">{sportLabel} Rankings · {list.total} rated</h2>
                <span className={`rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider ${list.source === "generated" ? "bg-volt-500/15 text-volt-300" : "bg-gold-500/15 text-gold-300"}`}>
                  {list.source === "generated" ? "Rating engine · record-based" : "Curated rankings"}
                </span>
              </div>
              {!sportValue && (
                <p className="mb-4 rounded-lg border border-ink-700 bg-ink-900/50 p-3 text-xs leading-relaxed text-fog">
                  Top-rated fighters across every combat sport. Pick a sport above for its divisional rankings and champions.
                </p>
              )}
              <div className="mx-auto max-w-3xl card-surface divide-y divide-ink-800 overflow-hidden">
                {list.items.map((r) => (
                  <Link key={r.fighter.slug} href={`/fighters/${r.fighter.slug}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-ink-800/60">
                    <span className="w-8 text-center font-display text-xl font-bold text-fog">{r.rank}</span>
                    <MovementIndicator movement={r.movement} />
                    <FighterAvatar fighter={r.fighter} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-display text-sm font-semibold text-chalk">
                        <Flag code={r.fighter.countryCode} /> {r.fighter.name}
                      </p>
                      <p className="text-xs text-fog">{formatRecord(r.fighter.wins, r.fighter.losses, r.fighter.draws)}</p>
                    </div>
                    {r.rating != null && <span className="font-display text-sm font-bold text-mist">{r.rating.toFixed(1)}</span>}
                  </Link>
                ))}
              </div>
              <Pager page={page} hasNext={(page + 1) * LIMIT < (list?.total ?? 0)} />
            </>
          ) : (
            <div className="card-surface p-10 text-center">
              <p className="font-display text-lg font-bold text-chalk">No live {sportLabel} rankings available yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-fog">As {sportLabel} fighters are added and results recorded, rankings generate automatically.</p>
              <Link href={`/fighters${sportSlug ? `?sport=${sportSlug}` : ""}`} className="mt-4 inline-block rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">Fighter directory</Link>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
