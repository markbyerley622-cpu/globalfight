import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { FighterAvatar } from "@/components/fighter-avatar";
import { getResults } from "@/lib/repo";
import { Flag } from "@/components/flag";
import { formatDate, formatRecord } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Fight Results",
  description: "Completed boxing cards with results, methods, rounds, scorecards and analysis.",
};

export const revalidate = 300;

export default async function ResultsPage() {
  const events = await getResults();
  return (
    <>
      <PageHero eyebrow="The record books" title="Results" description="Completed cards with verified results, methods, rounds and scorecards." />
      <div className="container-cr space-y-4 py-10">
        {events.map((e) => (
          <div key={e.id} className="card-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-5 py-3">
              <div>
                <h2 className="font-display text-xl font-bold text-chalk">{e.name}</h2>
                <p className="flex items-center gap-1.5 text-xs text-fog">
                  {formatDate(e.date)} · <MapPin className="size-3" /> {e.venue}, {e.country} <Flag code={e.countryCode} size="xs" />
                </p>
              </div>
              <Badge tone="neutral">Final</Badge>
            </div>
            <div className="divide-y divide-ink-800">
              {e.fights.map((f) => {
                const winner = f.winnerId === f.red.slug ? f.red : f.blue;
                const loser = f.winnerId === f.red.slug ? f.blue : f.red;
                return (
                  <Link key={f.id} href={`/predictions/${f.slug}`} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-800/50">
                    <FighterAvatar fighter={winner} size="sm" showFlag />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold text-chalk">
                        <span className="text-up">{winner.name}</span> def. {loser.name}
                      </p>
                      <p className="text-xs text-fog">{[formatRecord(winner.wins, winner.losses, winner.draws), f.weightClass].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="shrink-0 rounded bg-ink-700 px-2 py-1 text-xs font-bold text-mist">
                      {f.method}{f.roundEnded ? ` R${f.roundEnded}` : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
