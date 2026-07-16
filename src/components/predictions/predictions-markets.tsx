"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";
import { PageHero } from "@/components/page-hero";
import { MarketCard } from "@/components/predictions/market-card";
import { FightPulseCard } from "@/components/predictions/fight-pulse-card";
import { DreamFightCard } from "@/components/predictions/dream-fight-card";
import { fmtNum, marketDivergence } from "@/components/predictions/shared";
import type { PredictionMarket, MarketSort } from "@/features/predictions/types";

type SortKey = MarketSort | "controversial";
import type { CommunityMarketView, CommunityOption, MarketVote } from "@/features/predictions/community/types";

// ════════════════════════════════════════════════════════════════════════
//  Predictions — a premium sports-prediction experience, not a dashboard.
//  Three stacked destinations, all fed by /api/predictions (no provider code
//  here — the UI speaks only the normalized model):
//    1. Live Market Odds — real Polymarket/Kalshi markets, probability-first.
//    2. Fight Pulse — the community's collective read (who wins / props).
//    3. Make This Fight — dream matchups the community wills into existence.
// ════════════════════════════════════════════════════════════════════════

const SPORT_ORDER = [
  "All Sports", "Boxing", "MMA", "Kickboxing", "Muay Thai", "BJJ", "Bare Knuckle", "Wrestling", "Misfits",
];
const TABS = ["Markets", "Leaderboard", "My Stats"] as const;
const SORTS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "Most Popular" },
  { key: "closing", label: "Closing Soon" },
  { key: "trending", label: "Trending" },
  { key: "controversial", label: "Most Controversial" },
];

export function PredictionsMarkets() {
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Markets");
  const [sport, setSport] = useState("All Sports");
  const [sort, setSort] = useState<SortKey>("popular");

  const [live, setLive] = useState<PredictionMarket[]>([]);
  const [liveState, setLiveState] = useState<"loading" | "ready" | "error">("loading");
  const [community, setCommunity] = useState<CommunityMarketView[]>([]);
  const [marketVotes, setMarketVotes] = useState<Record<string, MarketVote>>({});

  useEffect(() => {
    let cancelled = false;
    setLiveState("loading");
    // "controversial" is derived client-side from divergence — fetch a lively
    // base (trending) and re-sort below; otherwise pass the sort straight through.
    const serverSort = sort === "controversial" ? "trending" : sort;
    const params = new URLSearchParams({ sort: serverSort, limit: "60" });
    if (sport !== "All Sports") params.set("sport", sport);
    fetch(`/api/predictions?${params}`)
      .then((r) => r.json())
      .then((d: { markets: PredictionMarket[] }) => {
        if (!cancelled) {
          setLive(d.markets ?? []);
          setLiveState("ready");
        }
      })
      .catch(() => !cancelled && setLiveState("error"));
    return () => {
      cancelled = true;
    };
  }, [sport, sort]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/predictions/community")
      .then((r) => r.json())
      .then((d: { markets: CommunityMarketView[] }) => !cancelled && setCommunity(d.markets ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Combat Register community votes for the visible live markets (batched).
  useEffect(() => {
    if (live.length === 0) return;
    let cancelled = false;
    fetch("/api/predictions/community/by-markets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: live.map((m) => m.id) }),
    })
      .then((r) => r.json())
      .then((d: { votes?: Record<string, MarketVote> }) => !cancelled && setMarketVotes(d.votes ?? {}))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, user?.id]);

  const voteMarket = useCallback(
    async (m: PredictionMarket, choice: string, kind: string, options: CommunityOption[]) => {
      if (!user) return;
      const res = await fetch("/api/predictions/community/market-vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerMarketId: m.id, sport: m.sport, title: m.title, kind, options, choice }),
      });
      const data = await res.json();
      if (res.ok) setMarketVotes((prev) => ({ ...prev, [m.id]: data.vote as MarketVote }));
    },
    [user],
  );

  const communityForSport = useMemo(
    () => community.filter((c) => sport === "All Sports" || c.sport === sport),
    [community, sport],
  );
  const pulse = communityForSport.filter((c) => c.kind === "who_wins" || c.kind === "prop" || c.kind === "fotn");
  const dreams = communityForSport.filter((c) => c.kind === "will_happen");

  const onVote = useCallback((updated: CommunityMarketView) => {
    setCommunity((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  const availableSports = useMemo(() => {
    const present = new Set<string>([...live.map((m) => m.sport), ...community.map((c) => c.sport)]);
    return SPORT_ORDER.filter((s) => s === "All Sports" || present.has(s));
  }, [live, community]);

  // "Most Controversial" = biggest fans-vs-market divergence (needs community
  // votes; markets without votes sink). Other sorts come pre-ordered from the API.
  const displayedLive = useMemo(() => {
    if (sort !== "controversial") return live;
    const key = (m: PredictionMarket) => {
      const d = marketDivergence(m, marketVotes[m.id]);
      return d ? Math.abs(d.delta) : -1;
    };
    return [...live].sort((a, b) => key(b) - key(a));
  }, [live, sort, marketVotes]);

  return (
    <>
      <PageHero
        eyebrow="Predict & Win"
        title="Prediction Markets"
        description="Real market odds from across combat sports, plus the community's own verdict on every fight. Free to play — no wagering is facilitated."
      />

      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 lg:max-w-5xl">
        <SegTabs tabs={TABS} value={tab} onChange={setTab} />

        {tab === "Leaderboard" ? (
          <LeaderboardPanel signedIn={Boolean(user)} name={user?.name ?? user?.username ?? null} />
        ) : tab === "My Stats" ? (
          <MyStatsPanel signedIn={Boolean(user)} community={community} />
        ) : (
          <>
            {/* Filters */}
            <div data-hscroll className="hide-scrollbar mt-4 flex gap-2 overflow-x-auto pb-0.5">
              {availableSports.map((s) => (
                <Pill key={s} label={s} active={sport === s} onClick={() => setSport(s)} />
              ))}
            </div>
            <div data-hscroll className="hide-scrollbar mt-2.5 flex gap-2 overflow-x-auto pb-0.5">
              {SORTS.map((s) => (
                <Pill key={s.key} label={s.label} active={sort === s.key} onClick={() => setSort(s.key)} subtle />
              ))}
            </div>

            {/* ── Live market odds ── */}
            <SectionHeader eyebrow="Live Market Odds" title="What The Market Says" />
            {liveState === "loading" ? (
              <CardSkeletonGrid />
            ) : live.length === 0 ? (
              <EmptyNote>
                No live markets for {sport === "All Sports" ? "this filter" : sport} right now. Try another sport.
              </EmptyNote>
            ) : (
              <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
                {displayedLive.map((m, i) => (
                  <div key={m.id} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                    <MarketCard
                      market={m}
                      community={marketVotes[m.id]}
                      canVote={Boolean(user)}
                      onVote={(choice, kind, options) => voteMarket(m, choice, kind, options)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* ── Fight Pulse ── */}
            <SectionHeader
              eyebrow="Fight Pulse"
              title="What The Fans Say"
              meta={pulse.length ? `${fmtNum(pulse.reduce((a, m) => a + m.voteCount, 0))} votes` : undefined}
            />
            {pulse.length === 0 ? (
              <EmptyNote>No community questions for {sport} yet.</EmptyNote>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {pulse.map((m) => (
                  <FightPulseCard key={m.id} market={m} canVote={Boolean(user)} onVote={onVote} />
                ))}
              </div>
            )}

            {/* ── Make This Fight ── */}
            {dreams.length > 0 && (
              <>
                <SectionHeader
                  eyebrow="Make This Fight"
                  title="Dream Matchups"
                  meta="Rumoured & demanded"
                />
                <p className="-mt-2 mb-3 text-sm text-mist">
                  The bouts the combat world is waiting for. Not announced — but the momentum is real. Call whether they get made.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {dreams.map((m) => (
                    <DreamFightCard key={m.id} market={m} canVote={Boolean(user)} onVote={onVote} />
                  ))}
                </div>
              </>
            )}

            <p className="mt-8 text-center text-[0.65rem] text-fog">
              Free to play. Live odds are sourced from third-party markets for analytical use — no wagering is facilitated.
            </p>
          </>
        )}
      </div>
    </>
  );
}

// ── Segmented tabs with a sliding indicator ────────────────────────────────
function SegTabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  const idx = tabs.indexOf(value);
  return (
    <div className="relative mt-4 flex rounded-xl border border-ink-800 bg-ink-900 p-1">
      <div
        className="seg-ind absolute bottom-1 top-1 left-1 rounded-lg bg-ink-800 shadow-[0_2px_10px_rgba(0,0,0,0.4)]"
        style={{ width: `calc((100% - 0.5rem) / ${tabs.length})`, transform: `translateX(calc(${idx} * 100%))` }}
      />
      {tabs.map((tb) => (
        <button
          key={tb}
          onClick={() => onChange(tb)}
          className={cn(
            "seg relative z-10 min-h-11 flex-1 rounded-lg py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide",
            value === tb ? "text-chalk" : "text-fog hover:text-mist",
          )}
        >
          {tb}
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 mt-9 flex items-end justify-between gap-3">
      <div>
        <div className="font-display text-[0.68rem] font-bold uppercase tracking-[0.2em] text-blood-400">{eyebrow}</div>
        <h2 className="mt-0.5 font-display text-xl font-bold uppercase tracking-tight text-chalk">{title}</h2>
      </div>
      {meta && <span className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-wide text-fog">{meta}</span>}
    </div>
  );
}

function Pill({ label, active, onClick, subtle }: { label: string; active: boolean; onClick: () => void; subtle?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "tap shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-[0.75rem] font-semibold",
        active
          ? subtle ? "border-blood-500/60 bg-blood-500/15 text-blood-300" : "border-chalk bg-chalk text-ink-950"
          : "border-ink-700 bg-ink-800 text-mist hover:border-ink-600 hover:text-chalk",
      )}
    >
      {label}
    </button>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/50 px-6 py-10 text-center text-sm text-fog">
      {children}
    </div>
  );
}

function CardSkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass h-52 rounded-2xl">
          <div className="cr-shimmer h-full w-full rounded-2xl opacity-40" />
        </div>
      ))}
    </div>
  );
}

// ── Leaderboard (premium, honest zero-state) ───────────────────────────────
function LeaderboardPanel({ signedIn, name }: { signedIn: boolean; name: string | null }) {
  const ranks = [
    { medal: "🥇", tone: "text-gold-300" },
    { medal: "🥈", tone: "text-mist" },
    { medal: "🥉", tone: "text-blood-300" },
  ];
  return (
    <div className="rise mt-6">
      <div className="glass overflow-hidden rounded-2xl p-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-gold-500/15 text-2xl">🏆</div>
        <h3 className="mt-3 font-display text-lg font-bold uppercase tracking-tight text-chalk">The Board Is Warming Up</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-mist">
          Top forecasters will rank here by accuracy, streak and prediction score once fights start resolving. Make your picks now to claim a spot.
        </p>
        <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
          {["Most Accurate", "Longest Streak", "This Month", "All Time"].map((c) => (
            <span key={c} className="rounded-full border border-ink-700 bg-ink-800 px-3 py-1 text-[0.68rem] font-semibold text-mist">{c}</span>
          ))}
        </div>
      </div>

      {/* Locked preview rows — shape without fabricated data */}
      <div className="mt-3 space-y-2">
        {ranks.map((r, i) => (
          <div key={i} className="glass flex items-center gap-3 rounded-xl px-4 py-3">
            <span className={cn("w-6 text-center text-lg", r.tone)}>{r.medal}</span>
            <div className="grid size-9 place-items-center rounded-full border border-ink-700 bg-ink-800 font-display text-xs font-bold text-fog">
              {i === 0 && signedIn ? (name?.[0]?.toUpperCase() ?? "1") : "—"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-bold text-chalk">
                {i === 0 && signedIn ? name ?? "You" : "Open spot"}
              </div>
              <div className="text-[0.66rem] text-fog">Accuracy · Streak · Score</div>
            </div>
            <span className="rounded-md bg-ink-800 px-2 py-1 text-[0.66rem] font-bold text-fog">—</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── My Stats (uses real community picks; Duolingo/GitHub feel) ──────────────
function MyStatsPanel({ signedIn, community }: { signedIn: boolean; community: CommunityMarketView[] }) {
  const myPicks = community.filter((m) => m.myVote);
  const sportsFollowed = new Set(myPicks.map((m) => m.sport));

  if (!signedIn) {
    return (
      <div className="rise mt-6">
        <div className="glass rounded-2xl p-8 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-blood-500/15 text-2xl">📊</div>
          <h3 className="mt-3 font-display text-lg font-bold uppercase tracking-tight text-chalk">Track Your Record</h3>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-mist">
            Sign in to build your prediction streak, accuracy and sport breakdown — like a training log for your fight IQ.
          </p>
          <Link href="/account" className="tap mt-4 inline-flex rounded-full bg-blood-500 px-5 py-2.5 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rise mt-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Picks Made" value={fmtNum(myPicks.length)} accent="up" />
        <StatTile label="Sports" value={String(sportsFollowed.size)} />
        <StatTile label="Accuracy" value="—" hint="After results" />
        <StatTile label="Streak" value="0" hint="Best 0" />
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="font-display text-[0.68rem] font-bold uppercase tracking-[0.2em] text-blood-400">Recent Picks</div>
        {myPicks.length === 0 ? (
          <p className="mt-2 text-sm text-mist">No picks yet. Head to <span className="text-chalk">Markets → Fight Pulse</span> and make your first call.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {myPicks.slice(0, 8).map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <span className="rounded-md bg-ink-800 px-2 py-0.5 text-[0.58rem] font-bold uppercase text-mist">{m.sport}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-chalk">{m.title}</span>
                <span className="shrink-0 text-[0.7rem] font-semibold text-up">
                  {m.options.find((o) => o.id === m.myVote)?.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sportsFollowed.size > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="font-display text-[0.68rem] font-bold uppercase tracking-[0.2em] text-blood-400">Favourite Sports</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {[...sportsFollowed].map((s) => (
              <span key={s} className="rounded-full border border-ink-700 bg-ink-800 px-3 py-1 text-[0.7rem] font-semibold text-mist">
                {s} · {myPicks.filter((m) => m.sport === s).length}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "up" }) {
  return (
    <div className="glass rounded-2xl p-3.5">
      <div className={cn("font-display text-2xl font-bold leading-none", accent === "up" ? "text-up" : "text-chalk")}>{value}</div>
      <div className="mt-1 text-[0.66rem] font-semibold uppercase tracking-wide text-mist">{label}</div>
      {hint && <div className="mt-0.5 text-[0.6rem] text-fog">{hint}</div>}
    </div>
  );
}
