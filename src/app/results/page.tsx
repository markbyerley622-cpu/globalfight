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

// Per-page canonical: without one, /results?page=4 canonicalises to the root via
// metadataBase and every page of history competes as the same document.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { page } = await searchParams;
  const n = Number.parseInt(page ?? "1", 10);
  const valid = Number.isFinite(n) && n > 1 ? n : 1;
  return {
    title: valid > 1 ? `Fight Results — page ${valid}` : "Fight Results",
    description: "Completed cards with recorded results, methods, rounds and scorecards.",
    alternates: { canonical: valid > 1 ? `/results?page=${valid}` : "/results" },
  };
}

export const revalidate = 300;

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const requested = Number.parseInt(rawPage ?? "1", 10);
  const { events, total, page, pageSize } = await getResults(
    Number.isFinite(requested) && requested > 0 ? requested : 1,
  );
  const lastPage = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
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
                  {cov.detail ? <p className="mt-1 text-2xs text-fog">{cov.detail}</p> : null}
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

        {/* Real pagination, because the alternative was shipping every completed
            card in history on one response — 987KB of uncompressed HTML with
            ~500 serialized fighter objects in it, per the audit. */}
        {lastPage > 1 && (
          <nav className="flex items-center justify-between gap-4 pt-4" aria-label="Results pages">
            {page > 1 ? (
              <Link
                href={page === 2 ? "/results" : `/results?page=${page - 1}`}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-semibold text-chalk hover:bg-ink-800"
                rel="prev"
              >
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <p className="text-xs text-fog" aria-live="polite">
              Page {page} of {lastPage} · {total} completed {total === 1 ? "card" : "cards"}
            </p>
            {page < lastPage ? (
              <Link
                href={`/results?page=${page + 1}`}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-semibold text-chalk hover:bg-ink-800"
                rel="next"
              >
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}

        {events.length === 0 && (
          <p className="py-16 text-center text-sm text-fog">No completed cards on this page.</p>
        )}
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
