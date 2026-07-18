"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Flame, Target, Trophy, Layers, ChevronRight } from "lucide-react";
import type { CardRarity } from "@prisma/client";

interface Stats {
  reputation: number; rank: number | null; accuracy: number;
  picksResolved: number; picksCorrect: number; pickStreak: number; bestPickStreak: number;
  cardsTotal: number; cardsByRarity: Record<CardRarity, number>;
  followsFighters: number; followsPromotions: number;
}
interface CardItem { id: string; rarity: CardRarity; fighter: { slug: string; name: string } }
interface ActivityItem { id: string; type: string; title: string; url: string | null; createdAt: string }

export const RARITY_TINT: Record<CardRarity, string> = {
  LEGEND: "text-gold-300",
  CHAMPION: "text-gold-400",
  EPIC: "text-volt-400",
  RARE: "text-blood-300",
  BASE: "text-fog",
};
const RARITY_ORDER: CardRarity[] = ["LEGEND", "CHAMPION", "EPIC", "RARE", "BASE"];

/** Profile 2.0 identity block: reputation, accuracy, streak, collection + recent
 *  activity — read from the intelligence engine via /api/me/stats. */
export function ProfileStats() {
  const [data, setData] = useState<{ stats: Stats | null; cards: CardItem[]; activity: ActivityItem[] } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/me/stats")
      .then((r) => r.json())
      .then((d) => { if (live) setData(d.signedIn ? d : { stats: null, cards: [], activity: [] }); })
      .catch(() => { if (live) setData({ stats: null, cards: [], activity: [] }); });
    return () => { live = false; };
  }, []);

  if (!data) {
    return <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-ink-800 bg-ink-900 py-8 text-mist"><Loader2 className="size-4 animate-spin" /> Loading your record…</div>;
  }
  const s = data.stats;
  if (!s) return null;

  return (
    <div className="mt-6 space-y-5">
      {/* Reputation headline */}
      <div className="overflow-hidden rounded-2xl border border-ink-800 bg-[radial-gradient(600px_200px_at_50%_0%,rgba(225,29,42,0.18),transparent_65%)] p-5 text-center">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-fog">Combat Reputation</p>
        <p className="mt-1 font-display text-5xl font-black tabular-nums text-chalk">{s.reputation.toLocaleString()}</p>
        {s.rank != null && (
          <p className="mt-1 text-xs font-semibold text-blood-300">Rank #{s.rank.toLocaleString()} on the board</p>
        )}
      </div>

      {/* Core stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon={Target} label="Accuracy" value={`${s.accuracy}%`} sub={`${s.picksCorrect}/${s.picksResolved} picks`} />
        <Tile icon={Flame} label="Streak" value={String(s.pickStreak)} sub={`best ${s.bestPickStreak}`} />
        <Tile icon={Layers} label="Cards" value={String(s.cardsTotal)} sub={`${s.cardsByRarity.CHAMPION + s.cardsByRarity.LEGEND} elite`} />
        <Tile icon={Trophy} label="Following" value={String(s.followsFighters + s.followsPromotions)} sub={`${s.followsFighters} fighters`} />
      </div>

      {/* Collection preview */}
      <Section title="Collection" href="/collection" cta="Open collection">
        <div className="mb-3 flex flex-wrap gap-2">
          {RARITY_ORDER.filter((r) => s.cardsByRarity[r] > 0).map((r) => (
            <span key={r} className="rounded-lg border border-ink-700 bg-ink-950/50 px-2.5 py-1 text-xs font-semibold">
              <span className={RARITY_TINT[r]}>{r[0] + r.slice(1).toLowerCase()}</span>
              <span className="ml-1.5 tabular-nums text-fog">{s.cardsByRarity[r]}</span>
            </span>
          ))}
          {s.cardsTotal === 0 && <p className="text-sm text-fog">No cards yet — predict correctly to earn a fighter&apos;s card.</p>}
        </div>
        {data.cards.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {data.cards.map((c) => (
              <Link key={c.id} href={`/fighters/${c.fighter.slug}`} className="shrink-0 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2 text-center">
                <p className={`text-[0.6rem] font-bold uppercase ${RARITY_TINT[c.rarity]}`}>{c.rarity}</p>
                <p className="mt-0.5 max-w-[8rem] truncate text-xs font-semibold text-chalk">{c.fighter.name}</p>
              </Link>
            ))}
          </div>
        )}
      </Section>

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
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub }: { icon: typeof Target; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-3.5 text-center">
      <Icon className="mx-auto mb-1 size-4 text-blood-400" />
      <p className="font-display text-2xl font-bold tabular-nums text-chalk">{value}</p>
      <p className="text-[0.6rem] uppercase tracking-wider text-fog">{label}</p>
      <p className="mt-0.5 text-[0.65rem] text-mist">{sub}</p>
    </div>
  );
}

function Section({ title, href, cta, children }: { title: string; href?: string; cta?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</h3>
        {href && <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-semibold text-blood-300">{cta} <ChevronRight className="size-3.5" /></Link>}
      </div>
      {children}
    </div>
  );
}
