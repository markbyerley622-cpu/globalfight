import type { Metadata } from "next";
import { Mic, Play } from "lucide-react";
import { PageHero } from "@/components/page-hero";

export const metadata: Metadata = {
  title: "Podcasts",
  description: "Combat-sports podcasts — fight breakdowns, interviews and weekly shows across boxing, MMA and more.",
  alternates: { canonical: "/podcasts" },
};

export const dynamic = "force-dynamic";

// Editorial placeholder shows until a real podcast feed/ingestion is wired up.
const SHOWS = [
  { title: "The Combat Register Show", host: "Combat Register", ep: "Weekly fight-week breakdown", sport: "All Sports" },
  { title: "Rounds & Reasons", host: "Boxing desk", ep: "Post-fight analysis & scorecards", sport: "Boxing" },
  { title: "Ground Game", host: "MMA desk", ep: "Grappling exchanges & matchmaking", sport: "MMA" },
  { title: "The Clinch", host: "Muay Thai desk", ep: "Technique deep-dives", sport: "Muay Thai" },
];

export default function PodcastsPage() {
  return (
    <>
      <PageHero eyebrow="Listen" title="Podcasts" description="Fight breakdowns, interviews and weekly shows across every discipline. Full episodes are on the way." />
      <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 lg:max-w-3xl">

      <h2 className="mb-3 mt-6 font-display text-base font-bold uppercase tracking-tight text-chalk">Shows</h2>
      <div className="space-y-3">
        {SHOWS.map((s) => (
          <div key={s.title} className="flex items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 p-3.5">
            <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-mist"><Mic className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-sm font-bold text-chalk">{s.title}</span>
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-fog">{s.sport}</span>
              </div>
              <div className="mt-0.5 truncate text-[0.78rem] text-mist">{s.ep}</div>
              <div className="mt-0.5 text-[0.66rem] text-fog">{s.host}</div>
            </div>
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-ink-700 bg-ink-800 text-fog"><Play className="ml-0.5 size-4" /></span>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-[0.68rem] text-fog">Episodes coming soon — subscribe from the app once shows go live.</p>
      </div>
    </>
  );
}
