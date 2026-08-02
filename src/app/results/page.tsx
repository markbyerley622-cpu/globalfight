import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { FighterAvatar } from "@/components/fighter-avatar";
import { getResults } from "@/lib/repo";
import { Flag } from "@/components/flag";
import { formatDate, formatRecord } from "@/lib/utils";
import { boutOutcomeView } from "@/lib/event-format";
import { resultCoverage } from "@/lib/events/result-coverage";

export const metadata: Metadata = {
  title: "Fight Results",
  description: "Completed cards with recorded results, methods, rounds and scorecards.",
};

export const revalidate = 300;

export default async function ResultsPage() {
  const events = await getResults();
  return (
    <>
      <PageHero
        eyebrow="The record books"
        title="Results"
        description="Completed cards with recorded results, methods, rounds and scorecards. Every outcome is shown as its source published it."
      />
      <div className="container-cr space-y-4 py-10">
        {events.map((e) => {
          // The SAME completeness rule the event page and the harvester use —
          // "Final" is now a claim we can defend, not a decoration on every card.
          const cov = resultCoverage({
            total: e.fights.length,
            decided: e.fights.filter((f) => !f.cancelled && boutOutcomeView(f).kind !== "pending").length,
            attempts: e.resultAttempts ?? 0,
            lastCoveragePct: e.resultCoveragePct ?? null,
          });
          return (
            <div key={e.id} className="card-surface overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-5 py-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-chalk">{e.name}</h2>
                  <p className="flex items-center gap-1.5 text-xs text-fog">
                    {formatDate(e.date)} · <MapPin className="size-3" /> {e.venue}, {e.country}{" "}
                    <Flag code={e.countryCode} name={e.country} size="xs" />
                  </p>
                </div>
                <div className="text-right">
                  <Badge tone={cov.state === "CONFIRMED" ? "neutral" : "volt"}>
                    {cov.state === "CONFIRMED" ? "Final" : cov.label}
                  </Badge>
                  {cov.detail ? <p className="mt-1 text-[0.68rem] text-fog">{cov.detail}</p> : null}
                </div>
              </div>
              <div className="divide-y divide-ink-800">
                {e.fights.map((f) => {
                  const v = boutOutcomeView(f);
                  // Avatar: the winner when there is one, otherwise the red corner —
                  // a neutral choice, since no corner is being credited.
                  const face = v.kind === "win" ? v.winner : f.red;
                  return (
                    <Link
                      key={f.id}
                      href={`/predictions/${f.slug}`}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-ink-800/50"
                    >
                      <FighterAvatar fighter={face} size="sm" showFlag />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-semibold text-chalk">
                          {v.kind === "win" ? (
                            <>
                              <span className="text-up">{v.winner.name}</span> def. {v.loser.name}
                            </>
                          ) : (
                            <>
                              {f.red.name} vs {f.blue.name}
                            </>
                          )}
                        </p>
                        <p className="text-xs text-fog">
                          {[
                            v.kind === "win"
                              ? formatRecord(v.winner.wins, v.winner.losses, v.winner.draws)
                              : null,
                            f.weightClass,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="shrink-0 rounded bg-ink-700 px-2 py-1 text-xs font-bold text-mist">
                        {v.kind === "win"
                          ? `${f.method ?? "Win"}${f.roundEnded ? ` R${f.roundEnded}` : ""}`
                          : v.kind === "draw"
                            ? "Draw"
                            : v.kind === "no-contest"
                              ? "No contest"
                              : v.kind === "cancelled"
                                ? "Cancelled"
                                : "Result pending"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
