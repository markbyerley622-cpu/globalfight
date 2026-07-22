import Link from "next/link";
import { Radio, ListChecks, Heart, TrendingUp, Trophy, Flame, Layers, Target, ChevronRight } from "lucide-react";
import type { HomeData } from "@/lib/home/recommendations";
import type { FightEvent } from "@/lib/types";
import { DiscoveryEventCard } from "@/components/events/discovery-event-card";
import { TrackClick } from "@/components/analytics-track";
import { VideoRail } from "@/components/feed/video-rail";

/**
 * Renders the intent-ranked home sections from the recommendation service.
 * Reuses DiscoveryEventCard for every event rail — one card, everywhere. Empty
 * sections drop out, so a brand-new user sees only what's relevant to them.
 */
export function PersonalizedHome({ data }: { data: HomeData }) {
  return (
    <div className="container-cr space-y-8 py-6">
      {data.live.length > 0 && (
        <Rail icon={Radio} title="Live now" tint="text-blood-400" events={data.live} live />
      )}
      {data.personalized && data.progress && (data.progress.reputation > 0 || data.progress.picksResolved > 0) && (
        <Progress data={data.progress} />
      )}
      {data.continueWeek.length > 0 && (
        <Rail icon={ListChecks} title="Continue your fight week" hint="events you've predicted" events={data.continueWeek} />
      )}
      {data.becauseYouFollow.length > 0 && (
        <Rail icon={Heart} title="Because you follow" hint="your fighters & promotions" events={data.becauseYouFollow} />
      )}
      {data.trending.length > 0 && (
        <Rail icon={TrendingUp} title={data.personalized ? "More upcoming" : "Upcoming"} events={data.trending} />
      )}
      {/* Last, and already density-clamped by the service — the home rails are
          event-led, and video is the garnish rather than the meal. */}
      <VideoRail videos={data.videos} title="Watch" moreHref="/clips" />
    </div>
  );
}

function Rail({
  icon: Icon, title, hint, tint, events, live,
}: {
  icon: typeof Radio; title: string; hint?: string; tint?: string; events: FightEvent[]; live?: boolean;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`size-4 ${tint ?? "text-blood-400"} ${live ? "animate-pulse" : ""}`} />
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-chalk">{title}</h2>
        {hint && <span className="text-xs text-fog">· {hint}</span>}
      </div>
      <TrackClick name="home_rail_click" props={{ section: title }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => (
          <DiscoveryEventCard key={e.id} event={e} />
        ))}
      </TrackClick>
    </section>
  );
}

function Progress({ data }: { data: NonNullable<HomeData["progress"]> }) {
  const tiles = [
    { icon: Trophy, label: "Reputation", value: data.reputation.toLocaleString(), href: "/leaderboard" },
    { icon: Target, label: "Accuracy", value: `${data.accuracy}%`, href: "/profile" },
    { icon: Flame, label: "Streak", value: String(data.pickStreak), href: "/profile" },
    { icon: Layers, label: "Cards", value: String(data.cardsTotal), href: "/collection" },
  ];
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-chalk">Your progress</h2>
        <Link href="/profile" className="inline-flex items-center gap-0.5 text-xs font-semibold text-blood-300">
          Profile <ChevronRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-2xl border border-ink-800 bg-ink-900 p-3.5 text-center transition-all hover:-translate-y-0.5 hover:border-blood-500/40">
            <t.icon className="mx-auto mb-1 size-4 text-blood-400" />
            <p className="font-display text-2xl font-bold tabular-nums text-chalk">{t.value}</p>
            <p className="text-[0.6rem] uppercase tracking-wider text-fog">{t.label}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
