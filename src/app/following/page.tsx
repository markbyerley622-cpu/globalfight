import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Users, Building2, ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getFollowingFeed, getFollowingSummary, type FeedItem } from "@/lib/following";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Following",
  description: "Everything from the events, fighters and promotions you follow — upcoming cards, results, and your battles.",
};

/**
 * The return leg. Nothing here is generic: every item comes from something the
 * user explicitly followed, or happened to them personally. The empty state is
 * treated as the most important state, because on day one it is the ONLY state.
 */
export default async function FollowingPage() {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  const [feed, summary] = await Promise.all([
    getFollowingFeed(user.id),
    getFollowingSummary(user.id),
  ]);

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-2xl">
        <header className="mb-5">
          <h1 className="font-display text-2xl font-black text-chalk">Following</h1>
          <p className="mt-1 text-sm text-fog">
            {summary.total > 0
              ? `${summary.events} event${summary.events === 1 ? "" : "s"} · ${summary.fighters} fighter${summary.fighters === 1 ? "" : "s"} · ${summary.promotions} promotion${summary.promotions === 1 ? "" : "s"}`
              : "Follow a card, a fighter or a promotion and it shows up here."}
          </p>
        </header>

        {feed.length === 0 ? (
          <EmptyFeed following={summary.total > 0} />
        ) : (
          <ol className="flex flex-col gap-2.5">
            {feed.map((item) => (
              <li key={item.id}>
                <FeedRow item={item} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <Link
      href={item.url}
      className="group flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3.5 transition-colors hover:border-blood-500/40 hover:bg-ink-900"
    >
      <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-800 text-base">
        {item.icon ?? "•"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold leading-snug text-chalk">{item.title}</span>
        {item.body && <span className="mt-0.5 block line-clamp-2 text-xs text-mist">{item.body}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.7rem] text-fog">
          {item.meta && <span>{item.meta}</span>}
          {item.kind === "personal" || item.kind === "result" || item.kind === "coverage" ? (
            <span>{timeAgo(item.at)}</span>
          ) : null}
        </span>
      </span>
      <ArrowRight className="mt-1 size-4 shrink-0 text-fog transition-transform group-hover:translate-x-0.5 group-hover:text-blood-300" />
    </Link>
  );
}

/** Following something but nothing has happened yet — a real, common state. */
function EmptyFeed({ following }: { following: boolean }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-6 text-center">
      <p className="font-display text-base font-bold text-chalk">
        {following ? "Nothing new yet" : "Your feed is empty"}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-fog">
        {following
          ? "Nothing has happened on what you follow in the last few weeks. Follow a few more and this fills up fast."
          : "Follow an event to get reminded, a fighter to know when they're booked, or a promotion to catch every card."}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Cta href="/events" icon={<CalendarDays className="size-4" />} label="Browse events" primary />
        <Cta href="/fighters" icon={<Users className="size-4" />} label="Find fighters" />
        <Cta href="/registry" icon={<Building2 className="size-4" />} label="Promotions" />
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="px-4 py-16">
      <div className="mx-auto max-w-md rounded-xl border border-ink-700 bg-ink-900/60 p-7 text-center">
        <h1 className="font-display text-xl font-black text-chalk">Following</h1>
        <p className="mt-2 text-sm text-fog">
          Sign in to follow events, fighters and promotions — and get everything they do in one place.
        </p>
        <Link
          href="/account"
          className="mt-4 inline-flex rounded-lg bg-blood-500 px-5 py-2.5 font-display text-xs font-semibold uppercase text-white transition-colors hover:bg-blood-400"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

function Cta({ href, icon, label, primary }: { href: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blood-400"
          : "inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3.5 py-2 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300"
      }
    >
      {icon} {label}
    </Link>
  );
}

export const dynamic = "force-dynamic";
