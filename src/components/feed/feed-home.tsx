"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Play, ChevronRight, X, Newspaper, Users, Flame, Target, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { Flag } from "@/components/flag";
import { getClientId, fmtViews, timeAgo, cleanTitle, type FeedVideo } from "./client";
import { HomeFilterDropdown } from "./home-filter-dropdown";
import { PREDICTION_MARKETS, PODCAST_SHOWS } from "@/lib/data/feed-extras";

/** Server-assembled data for the feed dashboard (see src/app/page.tsx). */
export type FeedHomeData = {
  hero: {
    eventSlug: string; eventName: string; venue: string; sport: string; days: number;
    weightClass: string; titleFight: boolean; redPct: number;
    red: FighterLite; blue: FighterLite;
  } | null;
  news: { slug: string; title: string; category: string; publishedAt: string; excerpt: string }[];
  result: {
    eventSlug: string; eventName: string; venue: string; winner: string; winnerInitials: string;
    loser: string; method: string; weightClass: string;
  } | null;
  communities: { slug: string; name: string; icon: string; memberCount: number; threadCount: number }[];
  threads: { slug: string; categorySlug: string; title: string; categoryName: string; replyCount: number }[];
};
type FighterLite = { name: string; initials: string; record: string; ko: number; countryCode?: string; stance?: string };

const PILLS = [
  { id: "for-you", label: "For You", sort: "smart" as const },
  { id: "following", label: "Following", sort: "top" as const },
  { id: "boxing", label: "Boxing", sort: "smart" as const, topic: "boxing" },
  { id: "mma", label: "MMA", sort: "smart" as const, topic: "ufc" },
  { id: "muaythai", label: "Muay Thai", sort: "smart" as const, topic: "muaythai" },
  { id: "bjj", label: "BJJ", sort: "smart" as const, topic: "bjj" },
];

// Video/clips feed is hidden from the display for now. All the machinery below
// (fetch, filter dropdown, cards, player modal) is intentionally kept in place —
// flip this to `true` to plug it back in.
const SHOW_VIDEOS: boolean = false;

const sectionHead = (title: string, action?: React.ReactNode) => (
  <div className="mb-3 mt-6 flex items-center justify-between px-0.5">
    <h3 className="font-display text-base font-bold uppercase tracking-tight text-chalk">{title}</h3>
    {action}
  </div>
);

export function FeedHome({ data }: { data: FeedHomeData }) {
  const [pill, setPill] = useState("for-you");
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [modal, setModal] = useState<FeedVideo | null>(null);
  const cid = useRef("anon");
  const token = useRef(0);

  const query = useMemo(() => {
    const p = PILLS.find((x) => x.id === pill)!;
    const o: Record<string, string> = { sort: p.sort };
    if (p.topic) o.topics = p.topic;
    return o;
  }, [pill]);

  const load = useCallback(async () => {
    const t = ++token.current;
    try {
      const p = new URLSearchParams({ ...query, cid: cid.current });
      const res = await fetch(`/api/feed?${p.toString()}`);
      const d = (await res.json()) as { videos: FeedVideo[] };
      if (t === token.current) setVideos(d.videos ?? []);
    } catch { /* keep last */ }
  }, [query]);

  useEffect(() => { cid.current = getClientId(); }, []);
  useEffect(() => { if (!SHOW_VIDEOS) return; const id = setTimeout(load, 120); return () => clearTimeout(id); }, [load]);

  const feedCards = videos.slice(0, 4);
  const h = data.hero;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-3 lg:max-w-3xl">
      {/* ── Feed filters — collapsed into a hamburger dropdown (hidden for now) ── */}
      {SHOW_VIDEOS && (
        <div className="flex items-center justify-between gap-3 pb-1">
          <span className="font-display text-lg font-bold uppercase tracking-tight text-chalk">Feed</span>
          <HomeFilterDropdown
            options={PILLS.map((p) => ({ id: p.id, label: p.label }))}
            value={pill}
            onChange={setPill}
          />
        </div>
      )}

      {/* ── Hero superfight ── */}
      {h && (
        <>
          <div className="mt-4 inline-flex items-center gap-2 font-display text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-blood-400">
            <span className="h-0.5 w-6 bg-blood-500" /> Superfight · Upcoming
          </div>
          <Link
            href={`/schedule/${h.eventSlug}`}
            className="mt-2.5 block overflow-hidden rounded-2xl border border-ink-700 bg-[radial-gradient(600px_260px_at_0%_0%,rgba(225,29,42,0.28),transparent_62%),radial-gradient(600px_260px_at_100%_100%,rgba(56,189,248,0.22),transparent_62%),linear-gradient(160deg,#12060a,#0a0d12)] p-4"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[0.72rem] font-semibold text-chalk">
                <span className="grid size-5 place-items-center rounded-md bg-gradient-to-br from-gold-300 to-gold-500"><Flame className="size-3 text-ink-950" /></span>
                {h.eventName}
              </span>
              <span className="font-display text-[0.7rem] font-semibold tracking-wide text-gold-400">
                ● {h.days} {h.days === 1 ? "DAY" : "DAYS"} · {h.sport}
              </span>
            </div>

            <div className="mt-3 flex items-stretch">
              <HeroCorner f={h.red} tone="red" />
              <div className="flex flex-col items-center justify-center gap-1 px-1">
                <span className="bg-gradient-to-br from-blood-400 to-blood-700 bg-clip-text font-display text-xl font-bold italic text-transparent">VS</span>
                <span className="text-center text-[0.55rem] font-semibold uppercase leading-tight tracking-wide text-fog">
                  {h.weightClass || "Main Event"}
                  {h.titleFight && <><br />Title</>}
                </span>
              </div>
              <HeroCorner f={h.blue} tone="volt" />
            </div>

            <div className="mt-3.5">
              <div className="mb-1.5 flex justify-between text-[0.7rem] font-semibold">
                <span className="text-blood-300">{h.red.name.split(" ").slice(-1)} {h.redPct}%</span>
                <span className="text-fog">MODEL PREDICTION</span>
                <span className="text-volt-400">{100 - h.redPct}% {h.blue.name.split(" ").slice(-1)}</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-md bg-ink-700">
                <div className="bg-gradient-to-r from-blood-500 to-blood-300" style={{ width: `${h.redPct}%` }} />
                <div className="ml-auto bg-gradient-to-r from-volt-500 to-volt-400" style={{ width: `${100 - h.redPct}%` }} />
              </div>
            </div>
          </Link>
        </>
      )}

      {/* ── Breaking news ── */}
      {data.news.length > 0 && (
        <>
          {sectionHead("Breaking", <Link href="/news" className="text-[0.72rem] font-semibold text-fog hover:text-chalk">All news →</Link>)}
          <Link
            href={`/news/${data.news[0].slug}`}
            className="relative flex min-h-[150px] flex-col justify-end overflow-hidden rounded-2xl border border-ink-800 bg-[radial-gradient(400px_220px_at_80%_0%,rgba(225,29,42,0.3),transparent_60%),linear-gradient(180deg,#131820,#0a0d12)] p-4"
          >
            <span className="absolute left-3 top-3 rounded-lg border border-blood-500/30 bg-blood-500/15 px-2.5 py-1 text-[0.68rem] font-bold text-blood-300">
              {data.news[0].category}
            </span>
            <h4 className="mt-1.5 font-display text-lg font-bold leading-tight text-chalk">{data.news[0].title}</h4>
            <div className="mt-1.5 text-[0.7rem] text-fog">Combat Register · {timeAgo(data.news[0].publishedAt)}</div>
          </Link>
          {data.news.length > 1 && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-ink-800 bg-ink-900 px-3.5">
              {data.news.slice(1).map((n, i) => (
                <Link key={n.slug} href={`/news/${n.slug}`} className={cn("flex gap-3 py-3", i > 0 && "border-t border-ink-800")}>
                  <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900"><Newspaper className="size-6 text-mist" /></span>
                  <span>
                    <span className="block text-[0.82rem] font-semibold leading-snug text-chalk">{n.title}</span>
                    <span className="mt-1.5 flex items-center gap-2 text-[0.66rem] text-fog">
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 font-semibold text-mist">{n.category}</span>
                      {timeAgo(n.publishedAt)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {SHOW_VIDEOS && feedCards.map((v) => (
        <button key={v.id} onClick={() => setModal(v)} className="mt-3 block w-full overflow-hidden rounded-2xl border border-ink-800 bg-ink-900 text-left">
          <span className="relative block aspect-video w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover" />
            <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90">
              <Play className="ml-0.5 size-5 fill-ink-950 text-ink-950" />
            </span>
          </span>
          <span className="block p-3.5">
            <span className="line-clamp-2 text-[0.85rem] font-semibold leading-snug text-chalk">{cleanTitle(v.title)}</span>
            <span className="mt-1.5 block text-[0.72rem] text-mist">{cleanTitle(v.channel)}{v.viewCount ? ` · ${fmtViews(v.viewCount)} views` : ""} · {timeAgo(v.publishedAt)}</span>
          </span>
        </button>
      ))}

      {/* ── Communities ── */}
      {data.communities.length > 0 && (
        <>
          {sectionHead("Communities", <Link href="/community" className="text-[0.72rem] font-semibold text-fog hover:text-chalk">Browse →</Link>)}
          <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
            {data.communities.map((c, i) => (
              <Link key={c.slug} href={`/community/${c.slug}`} className={cn("flex items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-ink-800")}>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-ink-700 bg-ink-800"><Users className="size-5 text-mist" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-chalk">{c.name}</span>
                  <span className="block text-[0.7rem] text-fog">{fmtViews(c.memberCount)} members · {c.threadCount} threads</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fog" />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── Forums ── */}
      {data.threads.length > 0 && (
        <>
          {sectionHead("Forums", <Link href="/forums" className="text-[0.72rem] font-semibold text-fog hover:text-chalk">All threads →</Link>)}
          <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
            {data.threads.map((t, i) => (
              <Link key={t.slug} href={`/forums/${t.categorySlug}/${t.slug}`} className={cn("block px-3.5 py-3", i > 0 && "border-t border-ink-800")}>
                <span className="block text-[0.82rem] font-semibold leading-snug text-chalk">{t.title}</span>
                <span className="mt-1.5 flex flex-wrap gap-2.5 text-[0.68rem] text-fog">
                  <span>{t.categoryName}</span><span>· {t.replyCount} replies</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── Predictions ── */}
      {sectionHead("Predictions", <Link href="/predictions" className="text-[0.72rem] font-semibold text-fog hover:text-chalk">See all →</Link>)}
      <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
        {PREDICTION_MARKETS.map((m, i) => (
          <Link key={m.id} href="/predictions" className={cn("flex items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-ink-800")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-ink-700 bg-ink-800 text-blood-400"><Target className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-chalk">{m.title}</span>
              <span className="block truncate text-[0.7rem] text-fog">{m.sub}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fog" />
          </Link>
        ))}
      </div>

      {/* ── Podcasts ── */}
      {sectionHead("Podcasts", <Link href="/podcasts" className="text-[0.72rem] font-semibold text-fog hover:text-chalk">See all →</Link>)}
      <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
        {PODCAST_SHOWS.map((s, i) => (
          <Link key={s.id} href="/podcasts" className={cn("flex items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-ink-800")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-ink-700 bg-ink-800 text-mist"><Mic className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-chalk">{s.title}</span>
              <span className="block truncate text-[0.7rem] text-fog">{s.sub}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fog" />
          </Link>
        ))}
      </div>

      {SHOW_VIDEOS && modal && <ClipModal v={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function HeroCorner({ f, tone }: { f: FighterLite; tone: "red" | "volt" }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
      <span className={cn(
        "grid size-16 place-items-center rounded-full border-2 font-display text-lg font-bold text-white",
        tone === "red" ? "border-blood-500/60 bg-gradient-to-br from-blood-500 to-blood-700 shadow-[0_0_22px_rgba(225,29,42,0.22)]"
                       : "border-volt-500/60 bg-gradient-to-br from-volt-500 to-[#16407a] shadow-[0_0_22px_rgba(56,189,248,0.22)]",
      )}>{f.initials}</span>
      <span className="flex items-center gap-1 font-display text-sm font-bold text-chalk">{f.name}</span>
      <span className="text-[0.72rem] font-semibold text-mist">{f.record} · {f.ko} KO</span>
      <span className="flex items-center gap-1 text-[0.62rem] text-fog"><Flag code={f.countryCode} size="xs" /> {f.stance ?? ""}</span>
    </div>
  );
}

function ClipModal({ v, onClose }: { v: FeedVideo; onClose: () => void }) {
  useScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="line-clamp-1 font-display font-semibold text-chalk">{cleanTitle(v.title)}</p>
          <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-chalk"><X className="size-5" /></button>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-ink-700 bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`}
            className="size-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
