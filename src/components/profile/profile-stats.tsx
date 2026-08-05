"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Flame, Target, Trophy, ListChecks } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

interface Stats {
  reputation: number; rank: number | null; accuracy: number;
  picksResolved: number; picksCorrect: number; pickStreak: number; bestPickStreak: number;
  followsFighters: number; followsPromotions: number;
}
interface ActivityItem { id: string; type: string; title: string; url: string | null; createdAt: string }

/** Profile 2.0 identity block: reputation, accuracy, streak, prediction record +
 *  recent activity — read from the intelligence engine via /api/me/stats. */
export function ProfileStats() {
  const [data, setData] = useState<{ stats: Stats | null; activity: ActivityItem[] } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/me/stats")
      .then((r) => r.json())
      .then((d) => { if (live) setData(d.signedIn ? d : { stats: null, activity: [] }); })
      .catch(() => { if (live) setData({ stats: null, activity: [] }); });
    return () => { live = false; };
  }, []);

  if (!data) {
    return <div className="mt-6 flex items-center justify-center gap-2 card-surface py-8 text-mist"><Loader2 className="size-4 animate-spin" /> Loading your record…</div>;
  }
  const s = data.stats;
  if (!s) return null;

  // A profile with no resolved picks is a wall of zeros — the most deflating
  // moment in the product. Replace it with a single invitation to the one
  // action that starts a record, rather than four "0" tiles and a link to an
  // empty history.
  const isNew = s.picksResolved === 0;
  const follows = s.followsFighters + s.followsPromotions;

  return (
    <div className="mt-6 space-y-5">
      {/* Reputation headline */}
      <div className="overflow-hidden rounded-card border border-ink-800 bg-[radial-gradient(600px_200px_at_50%_0%,rgba(225,29,42,0.18),transparent_65%)] p-5 text-center">
        <p className="text-3xs uppercase tracking-[0.25em] text-fog">Combat Reputation</p>
        <p className="mt-1 font-display text-5xl font-black tabular-nums text-chalk">{s.reputation.toLocaleString()}</p>
        {s.rank != null ? (
          <p className="mt-1 text-xs font-semibold text-blood-300">Rank #{s.rank.toLocaleString()} on the board</p>
        ) : isNew ? (
          <p className="mt-1 text-xs text-fog">Your record starts with your first call.</p>
        ) : null}
      </div>

      {isNew ? (
        // ── Activation: the profile IS the call to predict ────────────────
        <div className="rounded-card border border-blood-500/30 bg-blood-500/[0.06] p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-lg bg-blood-500/15 text-blood-300">
            <ListChecks className="size-6" />
          </span>
          <h3 className="mt-3 font-display text-lg font-bold text-chalk">Make your first prediction</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-fog">
            Call a fight, earn reputation when it lands, and climb the leaderboard. Skill, not betting.
          </p>
          <ButtonLink href="/events" className="mt-4">Find a fight to predict</ButtonLink>
          {follows === 0 && (
            <p className="mt-3 text-2xs text-fog">
              Or <Link href="/leaderboard" className="font-semibold text-blood-300 hover:text-blood-200">follow a fighter</Link> to fill your feed.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Core stat tiles — passive numbers made navigable. The record tiles
              open your prediction history; Following opens your feed. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={Target} label="Accuracy" value={`${s.accuracy}%`} sub={`${s.picksCorrect}/${s.picksResolved} picks`} href="/predictions/mine" />
            <Tile icon={Flame} label="Streak" value={String(s.pickStreak)} sub={`best ${s.bestPickStreak}`} href="/predictions/mine" />
            <Tile icon={ListChecks} label="Predictions" value={String(s.picksResolved)} sub={`${s.picksCorrect} correct`} href="/predictions/mine" />
            <Tile icon={Trophy} label="Following" value={String(follows)} sub={`${s.followsFighters} fighters`} href="/following" />
          </div>

          {/* Prediction history — the primary profile content, now a real page:
              every call, how it landed, what's still open. */}
          <Link
            href="/predictions/mine"
            className="flex items-center justify-between card-surface p-4 transition-colors hover:border-ink-700 hover:bg-ink-850"
          >
            <span>
              <span className="block font-display text-sm font-bold uppercase tracking-wide text-chalk">My predictions</span>
              <span className="block text-2xs text-fog">Every call you&apos;ve made — open one to see how it landed</span>
            </span>
            <span className="font-display text-sm font-semibold text-blood-300">View →</span>
          </Link>
          <Link
            href="/leaderboard"
            className="flex items-center justify-between card-surface p-4 transition-colors hover:border-ink-700 hover:bg-ink-850"
          >
            <span>
              <span className="block font-display text-sm font-bold uppercase tracking-wide text-chalk">See where you rank</span>
              <span className="block text-2xs text-fog">Your reputation against every predictor on the board</span>
            </span>
            <span className="font-display text-sm font-semibold text-blood-300">View →</span>
          </Link>

          {/* Recent activity */}
          {data.activity.length > 0 && (
            <Section title="Recent activity">
              <ul className="divide-y divide-ink-800">
                {data.activity.map((a) => (
                  <li key={a.id}>
                    <Link href={a.url ?? "#"} className="flex items-center gap-2 py-2 text-sm text-mist hover:text-chalk">
                      <span className="size-1.5 shrink-0 rounded-full bg-blood-400" />
                      <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, href }: { icon: typeof Target; label: string; value: string; sub: string; href?: string }) {
  const inner = (
    <>
      <Icon className="mx-auto mb-1 size-4 text-blood-400" />
      <p className="font-display text-2xl font-bold tabular-nums text-chalk">{value}</p>
      <p className="text-3xs uppercase tracking-wider text-fog">{label}</p>
      <p className="mt-0.5 text-3xs text-mist">{sub}</p>
    </>
  );
  const cls = "block card-surface p-3.5 text-center";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-ink-700 hover:bg-ink-850`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</h3>
      </div>
      {children}
    </div>
  );
}
