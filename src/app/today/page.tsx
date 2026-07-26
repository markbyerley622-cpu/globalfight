import type { Metadata } from "next";
import Link from "next/link";
import {
  Flame, Trophy, TrendingUp, Target, CalendarCheck, Swords, Users, Dumbbell,
  Layers, ArrowRight, Sparkles, CircleDot,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getTodayBriefing, type TodayItem } from "@/lib/identity/today";
import type { LadderProgress } from "@/lib/identity/milestones";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { timeAgo, cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Today",
  description: "What moved in your combat world since you were last here — your streak, your calls, your fighters, your gym.",
  alternates: { canonical: "/today" },
};

// ════════════════════════════════════════════════════════════════════════════
//  TODAY — the surface that exists on days with no fights.
//
//  Every other page here is organised around an event: a card, a bout, a
//  result. Those are moments, and a product made only of moments is opened
//  only at those moments. This page is organised around a PERSON: a streak
//  that moves because you turned up, a digest of what shifted while you were
//  away, and the rungs you are closest to finishing.
//
//  The order is deliberate — you turned up (streak), here's what changed
//  (digest), here's what to do (act), here's what you're close to
//  (collections). Standing before news before action before ambition.
// ════════════════════════════════════════════════════════════════════════════

const TONE_DOT: Record<TodayItem["tone"], string> = {
  win: "bg-volt-400",
  loss: "bg-blood-500",
  act: "bg-gold-400",
  neutral: "bg-ink-600",
};

const KIND_ICON: Record<TodayItem["kind"], React.ReactNode> = {
  settled: <Target className="size-4" />,
  announced: <CalendarCheck className="size-4" />,
  rankmove: <TrendingUp className="size-4" />,
  corner: <Users className="size-4" />,
  gym: <Dumbbell className="size-4" />,
  act: <Swords className="size-4" />,
};

const GROUP_ICON: Record<LadderProgress["group"], React.ReactNode> = {
  Predict: <Target className="size-3.5" />,
  Connect: <Users className="size-3.5" />,
  Train: <Dumbbell className="size-3.5" />,
  Collect: <Layers className="size-3.5" />,
};

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  // The briefing records the visit — that write is what makes the streak real —
  // so it runs before anything renders.
  const brief = await getTodayBriefing(user.id);
  const { streak, allMilestones: allLadders } = brief;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const firstName = (user.name ?? user.username ?? "").split(" ")[0];

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-2xl">
        <header className="mb-5">
          <p className="eyebrow">{today}</p>
          <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">
            {firstName ? `Today, ${firstName}` : "Today"}
          </h1>
          <p className="mt-1 text-sm text-fog">
            {brief.firstVisit
              ? "This is day one. Everything below is yours from here on."
              : "What moved in your combat world since your last visit."}
          </p>
        </header>

        {/* ── Standing: the streak is the headline, because it is the only
            number on this page that moved because you showed up. ── */}
        <section className="overflow-hidden rounded-2xl border border-ink-800 bg-[radial-gradient(520px_200px_at_12%_0%,rgba(225,29,42,0.22),transparent_65%),linear-gradient(150deg,#141923,#0a0d12)]">
          <div className="flex items-center gap-4 p-5">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl border border-blood-500/40 bg-blood-500/12">
              <Flame className={cn("size-8", streak.streak > 0 ? "text-blood-400" : "text-ink-600")} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-3xl font-black tabular-nums leading-none text-chalk">
                {streak.streak}
                <span className="ml-1.5 text-sm font-bold uppercase tracking-wider text-fog">
                  day{streak.streak === 1 ? "" : "s"} running
                </span>
              </p>
              <p className="mt-1.5 text-[0.72rem] text-fog">
                Best {streak.best} · {streak.activeDays} day{streak.activeDays === 1 ? "" : "s"} here all time
              </p>
            </div>
          </div>

          {/* Honest about both directions: a streak you quietly lost is worse
              than one you were told you lost. */}
          {streak.advancedToday && !streak.reset && !brief.firstVisit && (
            <p className="border-t border-ink-800 bg-volt-500/[0.07] px-5 py-2.5 text-[0.72rem] font-semibold text-volt-400">
              <Sparkles className="mr-1.5 inline size-3.5" />
              Day {streak.streak} logged. Come back tomorrow to keep it.
            </p>
          )}
          {streak.reset && (
            <p className="border-t border-ink-800 bg-ink-900/70 px-5 py-2.5 text-[0.72rem] text-mist">
              Your {streak.lostStreak}-day run ended. This is day one of the next one.
            </p>
          )}

          <div className="grid grid-cols-3 divide-x divide-ink-800 border-t border-ink-800">
            <Stat icon={<Trophy className="size-3.5 text-gold-400" />} label="Reputation" value={brief.reputation.toLocaleString()} />
            <Stat
              icon={<TrendingUp className="size-3.5 text-volt-400" />}
              label="This week"
              value={brief.repWeek > 0 ? `+${brief.repWeek}` : String(brief.repWeek)}
            />
            <Stat icon={<CircleDot className="size-3.5 text-mist" />} label="Rank" value={brief.rank ? `#${brief.rank}` : "—"} />
          </div>
        </section>

        {/* ── Act: a digest with nothing to do is a newsletter. ── */}
        <Section title="Do this today">
          {brief.act.length === 0 ? (
            <EmptyState
              compact
              icon={<Swords className="size-5" />}
              accent="#e11d2a"
              title="You're up to date"
              body="Every fighter you follow is called. Follow someone new and this fills itself."
              action={{ href: "/fighters", label: "Find fighters" }}
            />
          ) : (
            <ItemList items={brief.act} />
          )}
        </Section>

        {/* ── What changed while you were away. ── */}
        <Section title={brief.firstVisit ? "Latest" : "Since you were last here"}>
          {brief.changed.length === 0 ? (
            <EmptyState
              compact
              icon={<Users className="size-5" />}
              accent="#38bdf8"
              title="Quiet since your last visit"
              body="Follow fighters and callers, and this becomes your morning read: bookings, rank moves and the calls your corner is making."
              action={{ href: "/leaderboard", label: "Find callers to follow" }}
            />
          ) : (
            <ItemList items={brief.changed} />
          )}
        </Section>

        {/* ── Closest rungs: the return reason that survives a quiet week. ── */}
        <Section
          title="Close to done"
          aside={`${brief.milestonesEarned}/${brief.milestonesTotal} earned`}
        >
          {brief.milestones.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-ink-800 bg-ink-900/40 p-6 text-center text-sm text-fog">
              Every collection complete. That is not a sentence many people will read.
            </p>
          ) : (
            <div className="space-y-3">
              {brief.milestones.map((l) => <LadderRow key={l.id} ladder={l} featured />)}
            </div>
          )}
        </Section>

        {/* ── The full board. A collection you cannot see the shape of is not a
            collection. ── */}
        <Section title="Collections">
          <div className="space-y-5">
            {(["Predict", "Connect", "Train", "Collect"] as const).map((group) => {
              const rows = allLadders.filter((l) => l.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-2 flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-fog">
                    {GROUP_ICON[group]} {group}
                  </p>
                  <div className="space-y-2">
                    {rows.map((l) => <LadderRow key={l.id} ladder={l} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="font-display text-sm font-bold text-chalk">Your record lives on your profile</p>
            <p className="mt-0.5 text-[0.72rem] text-fog">Everything on this page compounds into one public page.</p>
          </div>
          <ButtonLink href={user.username ? `/u/${user.username}` : "/profile"} size="sm">View profile</ButtonLink>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="px-4 py-3 text-center">
      <p className="flex items-center justify-center gap-1.5 text-[0.62rem] uppercase tracking-wider text-fog">{icon}{label}</p>
      <p className="mt-0.5 font-display text-lg font-black tabular-nums text-chalk">{value}</p>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-fog">{title}</h2>
        {aside && <span className="text-[0.68rem] tabular-nums text-fog">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function ItemList({ items }: { items: TodayItem[] }) {
  return (
    <ul className="divide-y divide-ink-800 overflow-hidden rounded-2xl border border-ink-800">
      {items.map((i) => {
        const body = (
          <div className="flex items-start gap-3 bg-ink-900 px-4 py-3">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE_DOT[i.tone])} aria-hidden />
            <span className="mt-0.5 shrink-0 text-fog">{KIND_ICON[i.kind]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug text-chalk">{i.title}</span>
              {i.detail && <span className="mt-0.5 block truncate text-[0.72rem] text-fog">{i.detail}</span>}
            </span>
            {i.kind !== "act" && <span className="shrink-0 text-[0.68rem] text-fog">{timeAgo(i.when)}</span>}
            {i.kind === "act" && <ArrowRight className="mt-0.5 size-4 shrink-0 text-fog" />}
          </div>
        );
        return (
          <li key={i.id}>
            {i.href ? <Link href={i.href} className="block transition-colors hover:bg-ink-850">{body}</Link> : body}
          </li>
        );
      })}
    </ul>
  );
}

/** One collection ladder. `featured` gives it the CTA — the small rows are a
 *  board to read, not twelve competing buttons. */
function LadderRow({ ladder: l, featured }: { ladder: LadderProgress; featured?: boolean }) {
  const done = l.complete;
  return (
    <div className={cn("rounded-2xl border bg-ink-900 p-4", done ? "border-gold-500/30" : "border-ink-800")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate font-display text-sm font-bold text-chalk">{l.title}</p>
        <p className="shrink-0 text-[0.72rem] tabular-nums text-fog">
          {done ? `${l.value} — complete` : `${l.value} / ${l.next}`}
        </p>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className={cn("h-full rounded-full", done ? "bg-gold-400" : "bg-blood-500")}
          style={{ width: `${Math.max(l.pct, l.value > 0 ? 4 : 0)}%` }}
        />
      </div>

      <p className="mt-2 text-[0.72rem] text-fog">
        {done
          ? `${l.value} ${l.unit} — every rung cleared.`
          : l.remaining === 1
            ? `One more and that's ${l.next} ${l.unit}.`
            : `${l.remaining} more to ${l.next} ${l.unit}.`}
      </p>

      {featured && !done && (
        <Link href={l.href} className="mt-2.5 inline-flex items-center gap-1 text-[0.72rem] font-semibold text-blood-300 hover:text-blood-200">
          {l.cta} <ArrowRight className="size-3" />
        </Link>
      )}
    </div>
  );
}

function SignedOut() {
  return (
    <div className="px-4 pb-16 pt-10">
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<Flame className="size-6" />}
          accent="#e11d2a"
          title="Your combat life, one page"
          body="A daily record of your calls, your fighters, your gym and your streak — the part of Combat Reviews that is about you rather than the next card."
          action={{ href: "/account", label: "Sign in to start" }}
        />
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
