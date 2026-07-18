import type { Metadata } from "next";
import Image from "next/image";
import { Trophy, Flame, Target } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { getReputationLeaders } from "@/lib/reputation";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "The sharpest predictors on Combat Register — ranked by combat reputation, accuracy and streak.",
  alternates: { canonical: "/leaderboard" },
};

export default async function LeaderboardPage() {
  const leaders = await getReputationLeaders(50);

  return (
    <>
      <PageHero eyebrow="The Board" title="Leaderboard">
        <p className="max-w-xl text-sm text-mist">Reputation is earned by calling fights correctly. Climb it.</p>
      </PageHero>

      <div className="container-cr py-10">
        {leaders.length === 0 ? (
          <p className="card-surface p-10 text-center text-sm text-fog">
            The board is warming up — reputation appears once fights start resolving picks.
          </p>
        ) : (
          <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-ink-800">
            {leaders.map((u, i) => {
              const acc = u.picksResolved ? Math.round((u.picksCorrect / u.picksResolved) * 100) : 0;
              const medal = i === 0 ? "text-gold-300" : i === 1 ? "text-mist" : i === 2 ? "text-gold-600" : "text-fog";
              return (
                <div key={u.id} className="flex items-center gap-3 border-b border-ink-800 bg-ink-900 px-4 py-3 last:border-b-0">
                  <span className={`w-7 shrink-0 text-center font-display text-lg font-black tabular-nums ${medal}`}>{i + 1}</span>
                  {u.image ? (
                    <Image src={u.image} alt="" width={36} height={36} className="size-9 rounded-full object-cover" unoptimized />
                  ) : (
                    <span className="grid size-9 place-items-center rounded-full bg-blood-500/15 font-display text-sm font-bold text-blood-300">
                      {(u.name ?? u.username ?? "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-chalk">{u.name ?? u.username ?? "Anonymous"}</p>
                    <p className="flex items-center gap-3 text-[0.7rem] text-fog">
                      <span className="inline-flex items-center gap-1"><Target className="size-3" /> {acc}%</span>
                      <span className="inline-flex items-center gap-1"><Flame className="size-3" /> {u.bestPickStreak}</span>
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 font-display text-lg font-black tabular-nums text-chalk">
                    <Trophy className="size-4 text-gold-400" /> {u.reputation.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";
