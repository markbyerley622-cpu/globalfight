import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessagesSquare, ArrowRight } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Badge } from "@/components/ui/badge";
import { getFight, getFeaturedPredictions } from "@/lib/repo";
import { getCurrentUser } from "@/lib/auth";
import { getCrowdForFight, getMyPick } from "@/lib/picks";
import { Flag } from "@/components/flag";
import { formatRecord, koPercentage } from "@/lib/utils";
import { winningCorner } from "@/lib/event-format";
import { BoutPick } from "@/components/predictions/bout-pick";

export async function generateStaticParams() {
  const fights = await getFeaturedPredictions();
  return fights.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = await getFight(slug);
  if (!f) return {};
  const title = `${f.red.name} vs ${f.blue.name} — Prediction`;
  return { title, description: `Make your pick and see the crowd read for ${f.red.name} vs ${f.blue.name}.` };
}

export default async function PredictionDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fight = await getFight(slug);
  if (!fight) notFound();

  // Native crowd data — our own users, never third-party market prices, so this
  // is not gated by marketPricesEnabled (which only guards Kalshi/Polymarket).
  const user = await getCurrentUser();
  const [crowd, myPick] = await Promise.all([
    getCrowdForFight(slug),
    user ? getMyPick(user.id, slug) : Promise.resolve(null),
  ]);

  const done = fight.result !== "SCHEDULED";
  const winner = winningCorner(fight);

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
            <Link key={fx.slug} href={`/fighters/${fx.slug}`} className={`flex flex-col items-center gap-3 text-center transition-opacity hover:opacity-80 ${i === 1 ? "order-3" : ""}`}>
              <FighterAvatar fighter={fx} size="xl" showFlag />
              <div>
                <p className="flex items-center justify-center gap-2 font-display text-lg font-bold text-chalk"><Flag code={fx.countryCode} /> {fx.name}</p>
                <p className="text-xs text-fog">{[formatRecord(fx.wins, fx.losses, fx.draws), fx.wins ? `${koPercentage(fx.koWins, fx.wins)}% KO` : ""].filter(Boolean).join(" · ")}</p>
              </div>
            </Link>
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

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Crowd pick — the habit loop */}
          {done ? (
            <ResultCard fight={fight} winner={winner} crowd={crowd} />
          ) : (
            <BoutPick
              fightSlug={fight.slug}
              redName={fight.red.name}
              blueName={fight.blue.name}
              initialCrowd={crowd}
              initialPick={myPick}
            />
          )}

          {/* Discussion — predictions and argument sit together, never apart */}
          <div className="card-surface flex flex-col justify-center gap-3 p-5 text-center">
            <MessagesSquare className="mx-auto size-7 text-blood-400" />
            <p className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Argue the read</p>
            <p className="text-xs text-mist">Break down the matchup, back your pick, and see who called it.</p>
            <Link href="/forums" className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blood-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blood-600">
              Open the discussion <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

/** Once a bout resolves, the pick card becomes the outcome + how the crowd did. */
function ResultCard({
  fight,
  winner,
  crowd,
}: {
  fight: Awaited<ReturnType<typeof getFight>> & object;
  winner: "red" | "blue" | null;
  crowd: { red: number; blue: number; total: number };
}) {
  const winName = winner === "red" ? fight.red.name : winner === "blue" ? fight.blue.name : null;
  const crowdRight = winner === "red" ? crowd.red : winner === "blue" ? crowd.blue : 0;
  const pct = crowd.total ? Math.round((crowdRight / crowd.total) * 100) : 0;
  return (
    <div className="card-surface p-5">
      <span className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Result</span>
      <div className="mt-3 rounded-lg bg-ink-800 p-4 text-center">
        {winName ? (
          <p className="text-chalk">
            <span className="font-display text-lg font-bold text-blood-300">{winName}</span>
            {fight.method ? <span className="text-fog"> · {fight.method}{fight.roundEnded ? ` R${fight.roundEnded}` : ""}</span> : null}
          </p>
        ) : (
          <p className="text-mist">{fight.result === "DRAW" ? "Draw" : fight.result === "NO_CONTEST" ? "No contest" : "Result pending"}</p>
        )}
      </div>
      {crowd.total > 0 && winner && (
        <p className="mt-3 text-center text-xs text-fog">
          <span className="font-semibold text-chalk">{pct}%</span> of {crowd.total.toLocaleString()} picks called it right.
        </p>
      )}
    </div>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
