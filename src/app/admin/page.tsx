import Link from "next/link";
import { ShieldCheck, Users, Megaphone, Dumbbell, Flag, BarChart3, CalendarDays } from "lucide-react";
import { prisma } from "@/lib/db";
import { verificationStats } from "@/lib/identity-verification";
import { requireAdminPage } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  /admin — the console's front door.
//
//  ── Why this page had to exist ────────────────────────────────────────────
//  It didn't. `/admin` was a 404: the tree had layout.tsx and seven leaf pages,
//  and the layout's own "Operations" wordmark linked to /admin/events. So the
//  console had no landing page, no summary, and no way to find out that
//  somebody was waiting on a decision without opening each queue in turn and
//  counting. An operator's first question is "is there anything for me to do",
//  and nothing answered it.
//
//  Every number here is a COUNT of rows that exist. There is no estimate and no
//  derived engagement figure — those live on /admin/analytics, which is built on
//  lib/metrics. This page answers one question: what is waiting.
//
//  ── It guards ITSELF, and that is not belt-and-braces ─────────────────────
//  This originally said the layout's requireAdminPage() covered the whole tree,
//  so a check here would be redundant. That was WRONG, and it was verified
//  wrong against production: `curl https://…/admin` with no cookie returned 200
//  with `"children":"7"` next to "Registered accounts" in the flight payload.
//
//  A layout and its page render in PARALLEL in the App Router. `notFound()`
//  thrown in the layout swaps the UI for the 404 boundary — it does not cancel
//  the sibling page, which has already run its queries and serialised the
//  results into the RSC stream. The layout guard is a UI guard. It was never a
//  data guard, and every server page under /admin was leaking its query results
//  to anonymous callers because of that distinction.
//
//  So the guard goes next to the data, in every page that reads any. Same rule,
//  one definition (lib/admin/roles) — this is not a second copy of the rule,
//  it is the one rule applied where it actually stops a query.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The open-queue counts.
 *
 * Note the two status vocabularies — `FighterClaim` uses "PENDING", while
 * `GymClaim` and `PromoterClaim` use lowercase "pending", and `ForumReport`
 * uses "OPEN". That is pre-existing and deliberate per their schema comments;
 * this reads each in its own vocabulary rather than normalising, because
 * guessing wrong here shows a zero and a zero reads as "nothing to do".
 */
async function openQueues() {
  const [fighterClaims, gymClaims, promoterClaims, reports] = await Promise.all([
    prisma.fighterClaim.count({ where: { status: "PENDING" } }),
    prisma.gymClaim.count({ where: { status: "pending" } }),
    prisma.promoterClaim.count({ where: { status: "pending" } }),
    prisma.forumReport.count({ where: { status: "OPEN" } }),
  ]);
  return { fighterClaims, gymClaims, promoterClaims, reports };
}

export default async function AdminOverview() {
  // Guarded HERE, not only by the layout — see the note in lib/admin/guard.
  await requireAdminPage();

  const [stats, queues, users, upcomingEvents] = await Promise.all([
    verificationStats(),
    openQueues(),
    prisma.user.count(),
    prisma.event.count({ where: { date: { gte: new Date() } } }),
  ]);

  const waiting =
    stats.pending + queues.fighterClaims + queues.gymClaims + queues.promoterClaims + queues.reports;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-chalk">Operations</h1>
        <p className="mt-1 text-sm text-fog">
          {waiting === 0
            ? "Every queue is clear."
            : `${waiting} item${waiting === 1 ? "" : "s"} waiting on a decision.`}
        </p>
      </header>

      {/* ── Identity verification, deliberately given its own row ──
          It is the queue where a real person is blocked from using the product
          until somebody looks at their passport, so it does not sit in a grid
          of equals. When it is non-zero it is the loudest thing on the page. */}
      <Link
        href="/admin/identity-verification?status=PENDING"
        className={`mb-4 flex items-center gap-4 rounded-card border p-5 transition-colors ${
          stats.pending > 0
            ? "border-gold-500/40 bg-gold-500/10 hover:border-gold-500/70"
            : "border-ink-800 bg-ink-900 hover:border-ink-700"
        }`}
      >
        <ShieldCheck className={`size-7 shrink-0 ${stats.pending > 0 ? "text-gold-300" : "text-fog"}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-bold uppercase tracking-wide text-chalk">
            Identity verification
          </span>
          <span className="mt-0.5 block text-2xs text-fog">
            {stats.pending > 0
              ? "People are waiting to be verified — review their documents"
              : "No submissions awaiting review"}
            {" · "}
            {stats.approvedToday} approved today
          </span>
        </span>
        <span
          className={`font-display text-3xl font-black tabular-nums ${
            stats.pending > 0 ? "text-gold-300" : "text-ink-600"
          }`}
        >
          {stats.pending}
        </span>
      </Link>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QueueTile href="/admin/claims" icon={Users} label="Fighter claims" value={queues.fighterClaims} />
        <QueueTile href="/admin/gym-claims" icon={Dumbbell} label="Gym claims" value={queues.gymClaims} />
        <QueueTile href="/admin/promoter-claims" icon={Megaphone} label="Promoter applications" value={queues.promoterClaims} />
        <QueueTile href="/admin/reports" icon={Flag} label="Open reports" value={queues.reports} />
      </div>

      <h2 className="mb-2 font-display text-2xs font-bold uppercase tracking-[0.16em] text-fog">The product</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile icon={Users} label="Registered accounts" value={users} />
        <StatTile icon={CalendarDays} label="Upcoming events" value={upcomingEvents} />
        <Link
          href="/admin/analytics"
          className="flex items-center gap-3 rounded-card border border-ink-800 bg-ink-900 p-4 transition-colors hover:border-blood-500/40"
        >
          <BarChart3 className="size-5 shrink-0 text-blood-400" />
          <span>
            <span className="block font-display text-sm font-bold text-chalk">Product analytics</span>
            <span className="mt-0.5 block text-2xs text-fog">Retention, engagement, feature use</span>
          </span>
        </Link>
      </div>
    </div>
  );
}

/** A queue with a backlog reads gold; an empty one is deliberately quiet. */
function QueueTile({
  href, icon: Icon, label, value,
}: { href: string; icon: typeof Users; label: string; value: number }) {
  const busy = value > 0;
  return (
    <Link
      href={href}
      className={`rounded-card border p-4 transition-colors ${
        busy ? "border-gold-500/30 bg-gold-500/5 hover:border-gold-500/60" : "border-ink-800 bg-ink-900 hover:border-ink-700"
      }`}
    >
      <Icon className={`size-4 ${busy ? "text-gold-300" : "text-fog"}`} />
      <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${busy ? "text-gold-300" : "text-ink-600"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-2xs uppercase tracking-wide text-fog">{label}</p>
    </Link>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-card border border-ink-800 bg-ink-900 p-4">
      <Icon className="size-4 text-fog" />
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-chalk">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-2xs uppercase tracking-wide text-fog">{label}</p>
    </div>
  );
}
