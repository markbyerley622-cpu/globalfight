import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, Clock, Star, Trophy, Hourglass, Loader, MinusCircle, Ban } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import {
  pickStatus,
  isTerminal,
  STATUS_PRESENTATION,
  type PickStatus,
} from "@/lib/intelligence/pick-status";
import { getCurrentUser } from "@/lib/auth";
import { BackButton } from "@/components/back-button";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My Predictions",
  description: "Every fight you've called — your record, what's still open, and how each pick landed.",
};

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  KO: "KO/TKO", TKO: "KO/TKO", SUB: "Submission", SUBMISSION: "Submission",
  UD: "Decision", SD: "Decision", MD: "Decision", DECISION: "Decision",
};

export default async function MyPredictionsPage() {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  // The record HEADLINE comes from denormalised User counters (O(1), accurate at
  // any scale) and two cheap COUNTs — never from summing the pick rows, so a user
  // with thousands of calls doesn't stream them all. The LIST is capped.
  const PAGE = 200;
  const [picks, stats, openCount, totalCount] = await Promise.all([
    prisma.fightPick.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: PAGE,
      select: {
        corner: true, method: true, confidence: true, correct: true,
        fight: {
          select: {
            slug: true, date: true, result: true, titleFight: true,
            // Needed to DERIVE the pick's terminal state (see intelligence/pick-status).
            cancelled: true, picksResolvedAt: true,
            red: { select: { name: true } },
            blue: { select: { name: true } },
            event: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { picksResolved: true, picksCorrect: true } }),
    // Genuinely open = not fought yet. Counting every SCHEDULED bout here folded
    // "awaiting a result" into "Open", which is the conflation this page existed to
    // hide behind: a stuck prediction inflated the Open number and looked normal.
    prisma.fightPick.count({
      where: { userId: user.id, fight: { result: "SCHEDULED", date: { gt: new Date() } } },
    }),
    prisma.fightPick.count({ where: { userId: user.id } }),
  ]);

  const resolved = stats?.picksResolved ?? 0;
  const correct = stats?.picksCorrect ?? 0;
  const accuracy = resolved ? Math.round((correct / resolved) * 100) : 0;
  // Grouped by DERIVED terminal state, not by `result === "SCHEDULED"`. That test
  // called four different situations "Open": a fight next week, a fight that ended
  // with no result ingested, a decided fight whose grading never ran, and a void
  // bout. Only the first is genuinely open, and a reader could not tell them apart —
  // which is precisely how an unsettled prediction hides. See pick-status.ts.
  const withStatus = picks.map((p) => ({ ...p, status: pickStatus(p, p.fight) }));
  const open = withStatus.filter((p) => p.status === "OPEN");
  const waiting = withStatus.filter(
    (p) => p.status === "AWAITING_RESULT" || p.status === "AWAITING_SETTLEMENT",
  );
  const settled = withStatus.filter((p) => isTerminal(p.status));

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-2xl">
        <BackButton fallback="/profile" label="Back to profile" className="mb-5" />

        <header className="mb-5">
          <p className="eyebrow">Your record</p>
          <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">My Predictions</h1>
        </header>

        {totalCount === 0 ? (
          <EmptyState
            icon={<Trophy className="size-5 text-blood-400" />}
            title="No predictions yet"
            body="Call a fight and it lands here — with your confidence, your finish, and whether you nailed it once the bout resolves."
            action={{ href: "/events", label: "Find a fight to predict" }}
          />
        ) : (
          <>
            {/* Record summary — the payoff line. */}
            <div className="mb-6 grid grid-cols-3 gap-3">
              <Stat value={`${accuracy}%`} label="Accuracy" sub={`${correct}/${resolved}`} />
              <Stat value={String(openCount)} label="Open" sub="not fought yet" />
              <Stat value={String(totalCount)} label="Total calls" sub="all time" />
            </div>
            {totalCount > picks.length && (
              <p className="-mt-3 mb-5 text-center text-[0.7rem] text-fog">Showing your {picks.length} most recent calls.</p>
            )}

            {open.length > 0 && (
              <Section title="Open">
                {open.map((p) => <PickRow key={p.fight.slug} pick={p} status={p.status} username={user.username} />)}
              </Section>
            )}
            {waiting.length > 0 && (
              <Section title="Awaiting result">
                {waiting.map((p) => <PickRow key={p.fight.slug} pick={p} status={p.status} username={user.username} />)}
              </Section>
            )}
            {settled.length > 0 && (
              <Section title="Settled">
                {settled.map((p) => <PickRow key={p.fight.slug} pick={p} status={p.status} username={user.username} />)}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type PickData = {
  corner: string; method: string | null; confidence: number | null; correct: boolean | null;
  fight: {
    slug: string; date: Date; result: string; titleFight: boolean;
    cancelled: boolean; picksResolvedAt: Date | null;
    red: { name: string }; blue: { name: string }; event: { name: string } | null;
  };
};

// One row of presentation per terminal state. The engine names the state; this only
// dresses it — so "Settling" can never be rendered as "Open" again.
const STATUS_STYLE: Record<PickStatus, { icon: LucideIcon; tone: string; ring: string }> = {
  OPEN: { icon: Clock, tone: "text-fog", ring: "border-ink-700" },
  AWAITING_RESULT: { icon: Hourglass, tone: "text-mist", ring: "border-ink-700" },
  AWAITING_SETTLEMENT: { icon: Loader, tone: "text-volt-300", ring: "border-volt-500/40" },
  SETTLED_CORRECT: { icon: Check, tone: "text-up", ring: "border-up/40" },
  SETTLED_INCORRECT: { icon: X, tone: "text-down", ring: "border-down/40" },
  VOID: { icon: MinusCircle, tone: "text-fog", ring: "border-ink-700" },
  CANCELLED: { icon: Ban, tone: "text-fog", ring: "border-ink-700" },
};

function PickRow({ pick, status, username }: { pick: PickData; status: PickStatus; username: string | null }) {
  const { fight } = pick;
  const pickedName = pick.corner === "RED" ? fight.red.name : fight.blue.name;
  const opponent = pick.corner === "RED" ? fight.blue.name : fight.red.name;
  const method = pick.method ? METHOD_LABEL[pick.method] ?? pick.method : null;
  // A correct call opens its shareable Victory Card; everything else goes to the
  // bout. Needs a username to build the /u/ URL — fall back to the bout without.
  const href = pick.correct === true && username
    ? `/u/${username}/call/${fight.slug}`
    : `/fights/${fight.slug}`;

  const style = STATUS_STYLE[status];
  const outcome = { ...style, label: STATUS_PRESENTATION[status].label };
  const Icon = outcome.icon;

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 border-b border-ink-800 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-ink-800/50",
      )}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl border bg-ink-950/40", outcome.ring, outcome.tone)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold text-chalk">
          {pickedName} <span className="font-normal text-fog">vs {opponent}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-fog">
          {fight.event?.name && <span className="truncate">{fight.event.name}</span>}
          {fight.titleFight && <span className="text-gold-400">· Title</span>}
          {pick.confidence != null && (
            <span className="inline-flex items-center gap-0.5">
              · <Star className="size-3 fill-gold-400 text-gold-400" /> {pick.confidence}/5
            </span>
          )}
          {method && <span>· {method}</span>}
        </span>
      </span>
      <span className={cn("shrink-0 font-display text-[0.62rem] font-bold uppercase tracking-wide", outcome.tone)}>
        {outcome.label}
      </span>
    </Link>
  );
}

function Stat({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-3.5 text-center">
      <p className="font-display text-2xl font-bold tabular-nums text-chalk">{value}</p>
      <p className="text-[0.6rem] uppercase tracking-wider text-fog">{label}</p>
      <p className="mt-0.5 text-[0.65rem] text-mist">{sub}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 px-0.5 font-display text-[0.72rem] font-bold uppercase tracking-wider text-fog">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">{children}</div>
    </section>
  );
}

function SignedOut() {
  return (
    <div className="px-4 py-16">
      <div className="mx-auto max-w-md rounded-xl border border-ink-700 bg-ink-900/60 p-7 text-center">
        <h1 className="font-display text-xl font-black text-chalk">My Predictions</h1>
        <p className="mt-2 text-sm text-fog">Sign in to see every fight you&apos;ve called and how your picks landed.</p>
        <ButtonLink href="/account" className="mt-4">Sign in</ButtonLink>
      </div>
    </div>
  );
}
