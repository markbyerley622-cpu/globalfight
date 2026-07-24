import type { Metadata } from "next";
import Link from "next/link";
import { Crown, Medal } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { FighterAvatar } from "@/components/fighter-avatar";
import { MovementIndicator } from "@/components/ui/badge";
import { SportFilter } from "@/components/sport-filter";
import { Pager } from "@/components/pager";
import { getPoundForPoundPage } from "@/lib/repo";
import { SampleDataNote } from "@/components/sample-data-note";
import { curatedProvenance } from "@/lib/rankings/curated/lists";
import { SPORT_BY_SLUG, SPORT_LABEL } from "@/lib/sports";
import { getServerT } from "@/lib/i18n-server";
import { Flag } from "@/components/flag";
import { formatRecord } from "@/lib/utils";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

export const metadata: Metadata = {
  title: "Pound-for-Pound — All Combat Sports",
  description: "Pound-for-pound rankings across MMA, boxing, Muay Thai and more — the best fighters regardless of weight class. Filter by sport.",
};

export const dynamic = "force-dynamic";
const LIMIT = 10;

export default async function P4PPage({ searchParams }: { searchParams: Promise<{ sport?: string; page?: string }> }) {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().rankingsEnabled) {
    return <FeatureUnavailable title="Pound-for-Pound" reason="Rankings are not available. Our existing ranking data could not be traced to a licensed source, so it has been withdrawn. Rankings will return when a licensed source is in place." />;
  }
  const { sport: sportSlug, page: pageStr } = await searchParams;
  const sportEntry = sportSlug ? SPORT_BY_SLUG[sportSlug] : undefined;
  // undefined === "All Sports": the best pound-for-pound across every combat sport.
  const sportValue = sportEntry?.value;
  const sportLabel = sportValue ? SPORT_LABEL[sportValue] ?? "Boxing" : "All Combat Sports";
  const page = Math.max(0, Number(pageStr) - 1) || 0;

  const { items, total, source, usedFallback } = await getPoundForPoundPage(sportValue, page, LIMIT);
  const hasNext = (page + 1) * LIMIT < total;
  const generated = source === "generated";
  const podium = page === 0 ? items.slice(0, 3) : [];
  const rest = page === 0 ? items.slice(3) : items;
  const t = await getServerT();

  return (
    <>
      <PageHero
        eyebrow="The best on the planet"
        title="Pound for Pound"
        description="Cross-divisional greatness, ranked across every combat sport."
      />

      <div className="container-cr py-8">
        <SportFilter />

        {usedFallback && items.length > 0 && <SampleDataNote className="mt-6" />}

        {items.length === 0 ? (
          <div className="card-surface mt-6 p-10 text-center">
            {(() => {
              // Never a bare "no data": explain WHY and show the roadmap.
              const pendingSource = ["JUDO", "TAEKWONDO", "SAMBO"].includes(sportValue ?? "");
              return pendingSource ? (
                <>
                  <p className="font-display text-lg font-bold text-chalk">{sportLabel} P4P is on the roadmap</p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-fog">
                    {sportLabel} federations rank per weight class, and we haven&apos;t found a defensible
                    cross-weight pound-for-pound source. Rather than guess, we&apos;re leaving this empty until
                    a credible source is in place — every ranking here is source-backed.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-lg font-bold text-chalk">{sportLabel} rankings are compiling</p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-fog">
                    The {sportLabel} pound-for-pound list fills in automatically as fighter records and
                    source-backed rankings are ingested.
                  </p>
                </>
              );
            })()}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/p4p" className="inline-block rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">All combat sports</Link>
              <Link href="/fighters" className="inline-block rounded-lg border border-ink-700 px-4 py-2 font-display text-xs font-semibold uppercase text-mist hover:text-chalk">Fighter directory</Link>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wider text-fog">{sportLabel} · {total} {t("ranked")}</p>
              <ProvenanceBadge generated={generated} sportValue={sportValue} />
            </div>
            {/* Podium (first page only) */}
            {podium.length > 0 && (
              <div className="mb-8 grid items-end gap-4 sm:grid-cols-3">
                {[podium[1], podium[0], podium[2]].filter(Boolean).map((r) => {
                  const isFirst = r.rank === 1;
                  // 1 = gold, 2 = silver, 3 = bronze
                  const medal = r.rank === 1
                    ? { ring: "border-gold-500/50 bg-gradient-to-b from-gold-500/15 to-ink-900 shadow-glow-gold", accent: "text-gold-400" }
                    : r.rank === 2
                    ? { ring: "border-[#cfd4dc]/45 bg-gradient-to-b from-[#cfd4dc]/12 to-ink-900", accent: "text-[#cfd4dc]" }
                    : { ring: "border-[#cd7f32]/55 bg-gradient-to-b from-[#cd7f32]/15 to-ink-900", accent: "text-[#cd7f32]" };
                  return (
                    <Link
                      key={r.fighter.slug}
                      href={`/fighters/${r.fighter.slug}`}
                      className={`group relative flex flex-col items-center rounded-card border p-6 text-center transition-all ${medal.ring} ${isFirst ? "order-first sm:order-none sm:-mt-6 sm:pb-10" : ""}`}
                    >
                      {isFirst
                        ? <Crown className="absolute -top-4 size-8 text-gold-400" />
                        : <Medal className={`absolute -top-3.5 size-7 ${medal.accent}`} />}
                      <span className={`font-display text-5xl font-black ${medal.accent}`}>{r.rank}</span>
                      <FighterAvatar fighter={r.fighter} size={isFirst ? "xl" : "lg"} showFlag className="my-3" />
                      <p className="font-display text-lg font-bold text-chalk group-hover:text-blood-300">{r.fighter.name}</p>
                      {!sportValue && <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-blood-400">{SPORT_LABEL[r.fighter.sport] ?? r.fighter.sport}</p>}
                      <p className="text-xs text-fog">{formatRecord(r.fighter.wins, r.fighter.losses, r.fighter.draws)}</p>
                      {r.rating != null && <p className={`mt-2 font-display text-2xl font-bold ${medal.accent}`}>{r.rating.toFixed(1)}</p>}
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Ranked list */}
            <div className="mx-auto max-w-3xl card-surface divide-y divide-ink-800 overflow-hidden">
              {rest.map((r) => (
                <Link key={r.fighter.slug} href={`/fighters/${r.fighter.slug}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-ink-800/60">
                  <span className="w-8 text-center font-display text-xl font-bold text-fog">{r.rank}</span>
                  <MovementIndicator movement={r.movement} />
                  <FighterAvatar fighter={r.fighter} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-display text-sm font-semibold text-chalk">
                      <Flag code={r.fighter.countryCode} /> {r.fighter.name}
                    </p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-fog">
                      {!sportValue && <span className="font-semibold uppercase tracking-wide text-blood-400">{SPORT_LABEL[r.fighter.sport] ?? r.fighter.sport}</span>}
                      <span>{formatRecord(r.fighter.wins, r.fighter.losses, r.fighter.draws)}</span>
                    </p>
                  </div>
                  {r.rating != null && <span className="font-display text-sm font-bold text-mist">{r.rating.toFixed(1)}</span>}
                </Link>
              ))}
            </div>

            <Pager page={page} hasNext={hasNext} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Where a ranking came from — honest about method. Rating engine (algorithmic),
 * or curated (source-backed) with its confidence, freshness and the exact
 * sources it was compiled from. Never implies sanctioning-body approval.
 */
function ProvenanceBadge({ generated, sportValue }: { generated: boolean; sportValue: string | undefined }) {
  if (generated) {
    return (
      <span className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider bg-volt-500/15 text-volt-300">
        Rating engine · record-based
      </span>
    );
  }
  const prov = sportValue ? curatedProvenance(sportValue) : null;
  if (!prov) {
    // "All Sports" mixes curated + rating engine.
    return (
      <span className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider bg-gold-500/15 text-gold-300">
        Curated + rating engine
      </span>
    );
  }
  const conf = prov.confidence;
  const confClass = conf === "HIGH" ? "bg-volt-500/15 text-volt-300"
    : conf === "MEDIUM" ? "bg-gold-500/15 text-gold-300"
    : "bg-ink-700 text-mist";
  const when = new Date(`${prov.updated}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider bg-gold-500/15 text-gold-300">
        Curated · Source-backed
      </span>
      <span className={`rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider ${confClass}`} title="Confidence reflects how well sources agree.">
        {conf} confidence
      </span>
      <span className="text-[0.65rem] uppercase tracking-wider text-fog">Updated {when}</span>
      <span className="w-full text-right text-[0.65rem] text-fog">
        Compiled from{" "}
        {prov.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && ", "}
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blood-400 underline decoration-ink-700 underline-offset-2 hover:text-blood-300">{s.label}</a>
          </span>
        ))}
      </span>
    </div>
  );
}
