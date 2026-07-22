import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Trophy, Flame, Target, ShieldAlert, ArrowRight } from "lucide-react";
import { getLeaderboard, LEADER_WINDOWS, type Leader, type LeaderWindow } from "@/lib/reputation";
import { flags } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Two boards, one page: the sharpest predictors on Combat Reviews, and the official fighter rankings.",
  alternates: { canonical: "/leaderboard" },
};

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  The Leaderboard pillar carries TWO products that fans conflate and that must
//  never be conflated in the UI:
//
//    · the PREDICTOR board — our users, ranked by reputation earned calling
//      fights. Ours to compute, ours to publish.
//    · FIGHTER RANKINGS — an editorial compilation owned by whoever published
//      it. Gated behind RANKINGS_ENABLED and, until a licensed source exists,
//      shown as an explained absence rather than quietly omitted.
//
//  They live under one tab strip because that is where a fan looks for both,
//  and they are visually distinct because they are not the same kind of claim.
// ════════════════════════════════════════════════════════════════════════════

type Board = "predictors" | "fighters";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; window?: string }>;
}) {
  const sp = await searchParams;
  const board: Board = sp.board === "fighters" ? "fighters" : "predictors";
  const win = (LEADER_WINDOWS.find((w) => w.id === sp.window)?.id ?? "all") as LeaderWindow;

  const leaders = board === "predictors" ? await getLeaderboard(win, 50) : [];
  const rankingsOn = flags().rankingsEnabled;

  return (
    <div className="container-cr py-6 lg:py-8">
      <header className="mb-5">
        <p className="eyebrow">Compete &amp; climb</p>
        <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk lg:text-3xl">
          Leaderboard
        </h1>
        <p className="mt-1 max-w-xl text-sm text-fog">
          Top predictors ranked by accuracy, points and consistency — plus the official fighter rankings.
        </p>
      </header>

      {/* ── Product switch ── */}
      <div data-hscroll className="hide-scrollbar mb-4 flex gap-2 overflow-x-auto">
        <Segment href="/leaderboard" label="Predictor Leaderboard" active={board === "predictors"} />
        <Segment href="/leaderboard?board=fighters" label="Fighter Rankings" active={board === "fighters"} />
      </div>

      {board === "predictors" ? (
        <>
          {/* ── Time window ── */}
          <div data-hscroll className="hide-scrollbar mb-5 flex gap-2 overflow-x-auto">
            {LEADER_WINDOWS.map((w) => (
              <Segment
                key={w.id}
                href={w.id === "all" ? "/leaderboard" : `/leaderboard?window=${w.id}`}
                label={w.label}
                active={win === w.id}
                subtle
              />
            ))}
          </div>

          {leaders.length === 0 ? (
            <EmptyBoard window={win} />
          ) : (
            <>
              <Podium leaders={leaders.slice(0, 3)} />
              <ol className="mt-4 overflow-hidden rounded-2xl border border-ink-800">
                {leaders.map((u, i) => (
                  <LeaderRow key={u.id} leader={u} rank={i + 1} />
                ))}
              </ol>
              <p className="mt-3 text-center text-[0.68rem] text-fog">
                {win === "all"
                  ? "Points are earned by calling fights correctly. Upsets pay more than favourites."
                  : "Points earned inside this window. Accuracy and streak are career figures."}
              </p>
            </>
          )}
        </>
      ) : (
        <FighterRankings enabled={rankingsOn} />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Segment({
  href, label, active, subtle,
}: { href: string; label: string; active: boolean; subtle?: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "tap shrink-0 whitespace-nowrap rounded-full border px-4 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors",
        active
          ? subtle
            ? "border-chalk bg-chalk text-ink-950"
            : "border-blood-500 bg-blood-500 text-white shadow-[0_6px_20px_-8px_rgba(225,29,42,0.9)]"
          : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk",
      )}
    >
      {label}
    </Link>
  );
}

const MEDAL = ["text-gold-300", "text-mist", "text-gold-600"];

function Avatar({ leader, size }: { leader: Leader; size: number }) {
  const letter = (leader.name ?? leader.username ?? "?").slice(0, 1).toUpperCase();
  return leader.image ? (
    <Image
      src={leader.image}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-blood-500/15 font-display font-bold text-blood-300"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {letter}
    </span>
  );
}

/** Top three, given the weight the concept gives them. */
function Podium({ leaders }: { leaders: Leader[] }) {
  if (leaders.length < 3) return null;
  // Visual order is 2 · 1 · 3 — the winner in the middle, raised.
  const order = [leaders[1], leaders[0], leaders[2]];
  const rank = [2, 1, 3];
  return (
    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-ink-800 bg-gradient-to-b from-ink-850 to-ink-900 p-4">
      {order.map((u, i) => {
        const first = rank[i] === 1;
        return (
          <LeaderLink
            key={u.id}
            leader={u}
            className={cn(
              "flex flex-col items-center rounded-xl px-1.5 py-2 text-center transition-colors hover:bg-ink-850",
              first && "-mt-2",
            )}
          >
            <span className="relative">
              <Avatar leader={u} size={first ? 62 : 48} />
              <span
                className={cn(
                  "absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-ink-700 bg-ink-950 px-1.5 font-display text-[0.62rem] font-black",
                  MEDAL[rank[i] - 1],
                )}
              >
                {rank[i]}
              </span>
            </span>
            <span className={cn("mt-2.5 max-w-full truncate font-display font-bold text-chalk", first ? "text-sm" : "text-[0.78rem]")}>
              {u.name ?? u.username ?? "Anonymous"}
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 font-display text-[0.8rem] font-black tabular-nums text-gold-300">
              <Trophy className="size-3" /> {u.points.toLocaleString()}
            </span>
            <span className="text-[0.64rem] text-fog">{u.accuracy}% acc</span>
          </LeaderLink>
        );
      })}
    </div>
  );
}

function LeaderRow({ leader, rank }: { leader: Leader; rank: number }) {
  return (
    <li>
      <LeaderLink
        leader={leader}
        className="flex items-center gap-3 border-b border-ink-800 bg-ink-900 px-3.5 py-3 transition-colors last:border-b-0 hover:bg-ink-850"
      >
        <span className={cn("w-6 shrink-0 text-center font-display text-base font-black tabular-nums", MEDAL[rank - 1] ?? "text-fog")}>
          {rank}
        </span>
        <Avatar leader={leader} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-bold text-chalk">
            {leader.name ?? leader.username ?? "Anonymous"}
          </span>
          <span className="mt-0.5 flex items-center gap-3 text-[0.68rem] text-fog">
            <span className="inline-flex items-center gap-1"><Target className="size-3" /> {leader.accuracy}% acc</span>
            <span className="inline-flex items-center gap-1"><Flame className="size-3" /> {leader.bestPickStreak}</span>
            <span className="hidden sm:inline">{leader.picksCorrect}/{leader.picksResolved} correct</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-base font-black tabular-nums text-chalk">
            {leader.points.toLocaleString()}
          </span>
          <span className="block text-[0.62rem] uppercase tracking-wider text-fog">pts</span>
        </span>
      </LeaderLink>
    </li>
  );
}

/** A predictor without a username has no public page — the row must not be a
 *  link to nowhere. */
function LeaderLink({
  leader, className, children,
}: { leader: Leader; className?: string; children: React.ReactNode }) {
  if (!leader.username) return <div className={className}>{children}</div>;
  return <Link href={`/u/${leader.username}`} className={className}>{children}</Link>;
}

function EmptyBoard({ window: w }: { window: LeaderWindow }) {
  const label = LEADER_WINDOWS.find((x) => x.id === w)?.label.toLowerCase() ?? "this window";
  return (
    <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 px-6 py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-ink-700 bg-ink-850">
        <Trophy className="size-5 text-gold-400" />
      </span>
      <p className="mt-3 font-display text-base font-bold uppercase tracking-wide text-chalk">
        No points scored {w === "all" ? "yet" : label}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-fog">
        Reputation appears the moment fights start resolving picks. Make a call on an upcoming card and you&apos;re on
        the board.
      </p>
      <Link
        href="/events"
        className="tap mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-blood-400"
      >
        Find a card to call <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

/**
 * The second product. When rankings are licensed this links into the existing
 * /rankings surfaces; until then it says exactly why it is empty, because a
 * silently missing half of a page reads as a bug.
 */
function FighterRankings({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 px-6 py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-ink-700 bg-ink-850">
          <ShieldAlert className="size-5 text-gold-400" />
        </span>
        <p className="mt-3 font-display text-base font-bold uppercase tracking-wide text-chalk">
          Fighter rankings are withdrawn
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-fog">
          A divisional ranking table is an editorial compilation, not a fact. Ours could not be traced to a licensed
          source, so it is not displayed. Rankings return — divisions, P4P and champions — once a licensed source is
          in place.
        </p>
        <p className="mt-3 text-[0.7rem] text-fog">
          The predictor board above is unaffected: those points are earned on this platform.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <RankingCard href="/p4p" title="Pound for Pound" desc="The best in the world, regardless of division." />
      <RankingCard href="/rankings" title="Divisions" desc="Weight-class rankings across every sport." />
      <RankingCard href="/champions" title="Champions" desc="Every current title holder in one place." />
    </div>
  );
}

function RankingCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-4 transition-colors hover:border-gold-500/40 hover:bg-ink-850"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</span>
        <span className="mt-0.5 block text-[0.72rem] leading-relaxed text-fog">{desc}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-fog transition-transform group-hover:translate-x-0.5 group-hover:text-gold-300" />
    </Link>
  );
}
