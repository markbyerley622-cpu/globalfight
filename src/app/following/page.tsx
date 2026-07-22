import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays, Users, Building2, ArrowRight, Sparkles, Swords, Mic, Flame,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import {
  getFollowingFeed, getFollowingSummary, getRivals, getCornerMen,
  type FeedItem, type Rival,
} from "@/lib/following";
import { timeAgo, cn } from "@/lib/utils";
import { Chip, ChipRow } from "@/components/ui/chip";
import { VideoCardProvider } from "@/components/feed/video-card";
import { FeedCard } from "@/components/feed/feed-card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Following",
  description:
    "Everything from the events, fighters and promotions you follow — plus your rivals and the analysts worth reading.",
};

// ════════════════════════════════════════════════════════════════════════════
//  The Following pillar. Four surfaces under one tab strip:
//
//    Feed       everything you follow, one timeline
//    Rivals     the people you've actually battled (the concept calls this
//               "Friends"; this schema has no user→user follow graph, and
//               Rivalry is the real relationship — so the tab shows the real
//               thing rather than a stub of an invented one)
//    Events     just the cards — fight week, filtered
//    Corner Men analysis and shows
//
//  Every item still traces back to something the user asked for. This is not a
//  generic social feed and the tabs do not make it one.
// ════════════════════════════════════════════════════════════════════════════

type Tab = "feed" | "rivals" | "events" | "corner";

const TABS: { id: Tab; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "rivals", label: "Rivals" },
  { id: "events", label: "Events" },
  { id: "corner", label: "Corner Men" },
];

// Fighter bookings now live on the fighter card, so the Events tab is exactly
// what its name says: cards.
const EVENT_KINDS = new Set(["event_upcoming", "result"]);
// Video rides the main Feed tab only — the Events tab is the card schedule.

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  const sp = await searchParams;
  const tab = (TABS.find((t) => t.id === sp.tab)?.id ?? "feed") as Tab;

  const [feed, summary, rivals, corner] = await Promise.all([
    tab === "feed" || tab === "events" ? getFollowingFeed(user.id) : Promise.resolve<FeedItem[]>([]),
    getFollowingSummary(user.id),
    tab === "rivals" ? getRivals(user.id) : Promise.resolve<Rival[]>([]),
    tab === "corner" ? getCornerMen() : Promise.resolve<FeedItem[]>([]),
  ]);

  const items = tab === "events" ? feed.filter((i) => EVENT_KINDS.has(i.kind)) : feed;

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-2xl">
        <header className="mb-4">
          <p className="eyebrow">Stay connected</p>
          <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">Following</h1>
          <p className="mt-1 text-sm text-fog">
            {summary.total > 0
              ? `${summary.events} event${summary.events === 1 ? "" : "s"} · ${summary.fighters} fighter${summary.fighters === 1 ? "" : "s"} · ${summary.promotions} promotion${summary.promotions === 1 ? "" : "s"}`
              : "Follow a card, a fighter or a promotion and it shows up here."}
          </p>
        </header>

        <ChipRow className="mb-4">
          {TABS.map((t) => (
            <Chip key={t.id} href={t.id === "feed" ? "/following" : `/following?tab=${t.id}`} active={tab === t.id}>
              {t.label}
            </Chip>
          ))}
        </ChipRow>

        {tab === "rivals" ? (
          <RivalsTab rivals={rivals} />
        ) : tab === "corner" ? (
          <CornerTab items={corner} />
        ) : items.length === 0 ? (
          <EmptyFeed following={summary.total > 0} eventsOnly={tab === "events"} />
        ) : (
          // One provider around the whole list: opening a second video closes
          // the first, and nothing renders a player until it is clicked.
          <VideoCardProvider>
            <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {items.map((item) => (
                <li key={item.id} className={item.kind === "personal" ? "" : "md:col-span-1"}>
                  <FeedCard item={item} />
                </li>
              ))}
            </ol>
          </VideoCardProvider>
        )}
      </div>
    </div>
  );
}


// ── Rivals ──────────────────────────────────────────────────────────────────

function RivalsTab({ rivals }: { rivals: Rival[] }) {
  if (rivals.length === 0) {
    return (
      <EmptyState
        icon={<Swords className="size-5 text-blood-400" />}
        title="No rivals yet"
        body="Challenge someone to a Prediction Battle on any upcoming fight. Whoever calls it right takes the points — and the head-to-head record lives here."
        action={{ href: "/events", label: "Find a fight to battle on" }}
      />
    );
  }

  return (
    <ol className="flex flex-col gap-2.5">
      {rivals.map((r) => {
        const initial = (r.name ?? r.username ?? "?").slice(0, 1).toUpperCase();
        const body = (
          <>
            {r.image ? (
              <Image src={r.image} alt="" width={40} height={40} unoptimized className="size-10 shrink-0 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-blood-500/15 font-display text-sm font-bold text-blood-300">
                {initial}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold text-chalk">
                {r.name ?? r.username ?? "Anonymous"}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-[0.7rem] text-fog">
                <span className="tabular-nums">
                  <span className="text-up">{r.wins}W</span> · <span className="text-down">{r.losses}L</span>
                  {r.draws > 0 && <> · {r.draws}D</>}
                </span>
                <span>·</span>
                <span>last battle {timeAgo(r.lastBattleAt)}</span>
              </span>
            </span>
            {r.streak !== 0 && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-display text-[0.66rem] font-bold uppercase tracking-wide",
                  r.streak > 0 ? "bg-up/15 text-up" : "bg-down/15 text-down",
                )}
              >
                <Flame className="size-3" />
                {Math.abs(r.streak)} {r.streak > 0 ? "you" : "them"}
              </span>
            )}
          </>
        );
        const cls = "flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3.5 transition-colors hover:border-blood-500/40 hover:bg-ink-900";
        return (
          <li key={r.userId}>
            {r.username ? <Link href={`/u/${r.username}`} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

// ── Corner Men ──────────────────────────────────────────────────────────────

function CornerTab({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Link
        href="/podcasts"
        className="group flex items-center gap-3 rounded-xl border border-ink-700 bg-gradient-to-r from-ink-850 to-ink-900 p-3.5 transition-colors hover:border-blood-500/40"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blood-500/12 text-blood-300">
          <Mic className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-bold text-chalk">Shows &amp; podcasts</span>
          <span className="block text-[0.72rem] text-fog">Fight-week breakdowns, interviews and weekly shows.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-fog transition-transform group-hover:translate-x-0.5 group-hover:text-blood-300" />
      </Link>

      {items.length === 0 ? (
        <EmptyState
          icon={<Mic className="size-5 text-blood-400" />}
          title="No analysis published yet"
          body="Breakdowns and interviews from the desk land here as they publish."
          action={{ href: "/news", label: "Browse the news desk" }}
        />
      ) : (
        <>
          <h2 className="mt-2 px-1 font-display text-[0.72rem] font-bold uppercase tracking-wider text-fog">
            Corner men insight
          </h2>
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((i) => (
              <li key={i.id}><FeedCard item={i} /></li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

// ── Shared states ───────────────────────────────────────────────────────────

/** Following something but nothing has happened yet — a real, common state. */
function EmptyFeed({ following, eventsOnly }: { following: boolean; eventsOnly: boolean }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-6 text-center">
      <p className="font-display text-base font-bold text-chalk">
        {eventsOnly ? "No cards coming up" : following ? "Nothing new yet" : "Your feed is empty"}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-fog">
        {eventsOnly
          ? "Nothing you follow has a card booked in the next few weeks."
          : following
            ? "Nothing has happened on what you follow in the last few weeks. Follow a few more and this fills up fast."
            : "Follow an event to get reminded, a fighter to know when they're booked, or a promotion to catch every card."}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {/* The fastest route out of an empty feed is the flow that fills it. */}
        <Cta href="/welcome" icon={<Sparkles className="size-4" />} label="Set up my feed" primary />
        <Cta href="/events" icon={<CalendarDays className="size-4" />} label="Browse events" />
        <Cta href="/map" icon={<Users className="size-4" />} label="Near me" />
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
