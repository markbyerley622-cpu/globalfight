import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LineChart, Users, UserCheck, Target } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { FighterAvatar } from "@/components/fighter-avatar";
import { ProbabilityBar } from "@/components/probability-bar";
import { Badge } from "@/components/ui/badge";
import { getFight, getFeaturedPredictions } from "@/lib/repo";
import { Flag } from "@/components/flag";
import { formatRecord, koPercentage } from "@/lib/utils";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

export async function generateStaticParams() {
  const fights = await getFeaturedPredictions();
  return fights.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = await getFight(slug);
  if (!f) return {};
  const title = `${f.red.name} vs ${f.blue.name} — Prediction`;
  return { title, description: `Win probability, method and round forecast for ${f.red.name} vs ${f.blue.name}.` };
}

const PredCard = ({ icon: Icon, label, redName, blueName, redPct, accent }: {
  icon: typeof LineChart; label: string; redName: string; blueName: string; redPct: number; accent?: boolean;
}) => (
  <div className={`card-surface p-5 ${accent ? "ring-1 ring-blood-500/30" : ""}`}>
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-blood-400" />
      <span className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{label}</span>
    </div>
    <ProbabilityBar redLabel={redName} blueLabel={blueName} redProbability={redPct / 100} />
  </div>
);

export default async function PredictionDetail({ params }: { params: Promise<{ slug: string }> }) {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().marketPricesEnabled) {
    return <FeatureUnavailable title="Predictions" reason="Prediction-market prices are not available. Market data from third-party trading venues is disabled pending licensing and regulatory review." />;
  }
  const { slug } = await params;
  const fight = await getFight(slug);
  if (!fight) notFound();

  const p = fight.prediction;
  const aiRed = Math.round((p?.redProbability ?? 0.5) * 100);
  const communityRed = Math.round((p?.communityRed ?? 0.5) * 100);
  const expertRed = Math.round((p?.expertRed ?? 0.5) * 100);

  return (
    <>
      <PageHero eyebrow={fight.titleFight ? "Championship Fight Outlook" : "Fight Outlook"} title={`${fight.red.name} vs ${fight.blue.name}`}>
        <div className="flex flex-wrap gap-2">
          {fight.weightClass && <Badge tone="neutral">{fight.weightClass}</Badge>}
          <Badge tone="neutral">{fight.scheduledRounds} rounds</Badge>
          {fight.titleFight && <Badge tone="gold">Title Fight</Badge>}
        </div>
      </PageHero>

      <div className="container-cr py-10">
        {/* Tale of the tape */}
        <div className="card-surface mb-8 grid grid-cols-[1fr_auto_1fr] items-center gap-4 p-6">
          {[fight.red, fight.blue].map((fx, i) => (
            <div key={fx.slug} className={`flex flex-col items-center gap-3 text-center ${i === 1 ? "order-3" : ""}`}>
              <FighterAvatar fighter={fx} size="xl" showFlag />
              <div>
                <p className="flex items-center justify-center gap-2 font-display text-lg font-bold text-chalk"><Flag code={fx.countryCode} /> {fx.name}</p>
                <p className="text-xs text-fog">{[formatRecord(fx.wins, fx.losses, fx.draws), fx.wins ? `${koPercentage(fx.koWins, fx.wins)}% KO` : ""].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          ))}
          <div className="order-2 flex size-14 items-center justify-center rounded-full bg-blood-500 font-display text-xl font-black text-white shadow-glow-red">VS</div>
        </div>

        {/* Tape comparison */}
        <div className="card-surface mb-8 grid gap-3 p-6 sm:grid-cols-2">
          {([
            ["Height", fight.red.heightCm, fight.blue.heightCm, "cm"],
            ["Reach", fight.red.reachCm, fight.blue.reachCm, "cm"],
            ["Wins", fight.red.wins, fight.blue.wins, ""],
            ["KO Wins", fight.red.koWins, fight.blue.koWins, ""],
          ] as const).map(([label, rv, bv, unit]) => {
            const rVal = rv ?? 0, bVal = bv ?? 0; const total = Math.max(1, rVal + bVal);
            return (
              <div key={label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-display font-bold text-blood-300">{rVal}{unit}</span>
                  <span className="uppercase tracking-wide text-fog">{label}</span>
                  <span className="font-display font-bold text-volt-400">{bVal}{unit}</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div className="bg-blood-500" style={{ width: `${(rVal / total) * 100}%` }} />
                  <div className="bg-volt-500" style={{ width: `${(bVal / total) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Prediction grid */}
        <div className="grid gap-4 lg:grid-cols-2">
          <PredCard icon={LineChart} label="Model Projection" redName={fight.red.name} blueName={fight.blue.name} redPct={aiRed} accent />
          <PredCard icon={Users} label="Community Picks" redName={fight.red.name} blueName={fight.blue.name} redPct={communityRed} />
          <PredCard icon={UserCheck} label="Expert Consensus" redName={fight.red.name} blueName={fight.blue.name} redPct={expertRed} />
          <div className="card-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <Target className="size-4 text-gold-400" />
              <span className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Expected Outcome</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-ink-950/40 p-3 text-center">
                <p className="text-[0.6rem] uppercase tracking-wider text-fog">Likely Method</p>
                <p className="font-display text-2xl font-bold text-gold-400">{p?.methodPrediction ?? "DEC"}</p>
              </div>
              <div className="rounded-lg bg-ink-950/40 p-3 text-center">
                <p className="text-[0.6rem] uppercase tracking-wider text-fog">Likely Round</p>
                <p className="font-display text-2xl font-bold text-gold-400">{p?.roundPrediction ?? "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {p?.rationale && (
          <div className="card-surface mt-8 p-6">
            <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-fog">Matchup Analysis</h3>
            <p className="text-sm leading-relaxed text-mist">{p.rationale}</p>
          </div>
        )}
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
