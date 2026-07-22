"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Search, X, Loader2, Users, CalendarDays, Newspaper, MessagesSquare, Compass, Dumbbell, BadgeCheck, User, Play } from "lucide-react";
import { Flag } from "@/components/flag";

type FighterHit = { slug: string; name: string; nickname?: string | null; countryCode?: string | null; nationality?: string | null; record: string };
type Results = {
  fighters: FighterHit[];
  events: { slug: string; name: string; city: string | null }[];
  gyms: { slug: string; name: string; place: string | null; verified: boolean; memberCount: number; disciplines: string[] }[];
  people: { username: string; name: string | null; image: string | null; role: string; reputation: number }[];
  articles: { slug: string; title: string; category: string }[];
  videos: { id: string; title: string; channel: string; promotion: string | null; reason: string }[];
  communities: { slug: string; name: string }[];
  threads: { slug: string; categorySlug: string; title: string; categoryName: string }[];
  pages: { label: string; href: string }[];
};
const EMPTY: Results = { fighters: [], events: [], gyms: [], people: [], articles: [], communities: [], threads: [], videos: [], pages: [] };

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQ(""); setRes(EMPTY); }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const run = useCallback(async (value: string) => {
    if (!value.trim()) { setRes(EMPTY); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      setRes({ ...EMPTY, ...(await r.json()) });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(q), 180);
    return () => clearTimeout(t);
  }, [q, run]);

  if (!open) return null;

  // Every result family must be counted here — a family missing from this sum
  // renders "No results for …" ABOVE its own visible rows.
  const total =
    res.fighters.length + res.events.length + res.gyms.length + res.people.length +
    res.articles.length + res.videos.length + res.communities.length + res.threads.length + res.pages.length;

  const row = (key: string, href: string, icon: React.ReactNode, title: React.ReactNode, sub?: React.ReactNode) => (
    <Link key={key} href={href} onClick={onClose} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-700/70">
      <span className="grid size-8 shrink-0 place-items-center text-mist">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-semibold text-chalk">{title}</span>
        {sub && <span className="block truncate text-xs text-fog">{sub}</span>}
      </span>
    </Link>
  );

  const head = (label: string) => <p className="px-3 pb-1 pt-3 font-display text-[0.62rem] font-bold uppercase tracking-widest text-fog">{label}</p>;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl card-surface overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink-700 px-4">
          <Search className="size-5 text-mist" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the whole site — fighters, events, news, communities…"
            className="h-14 flex-1 bg-transparent text-base text-chalk outline-none placeholder:text-fog"
          />
          {loading && <Loader2 className="size-4 animate-spin text-mist" />}
          <button onClick={onClose} className="rounded-md p-1.5 text-mist hover:bg-ink-700 hover:text-chalk" aria-label="Close search"><X className="size-5" /></button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!q && <p className="px-4 py-8 text-center text-sm text-fog">Start typing to search across the whole site.</p>}
          {q && !loading && total === 0 && <p className="px-4 py-8 text-center text-sm text-fog">No results for “{q}”.</p>}

          {res.fighters.length > 0 && head("Fighters")}
          {res.fighters.map((h) => row(`f-${h.slug}`, `/fighters/${h.slug}`, <Flag code={h.countryCode} size="lg" />,
            <>{h.name}{h.nickname ? <span className="ml-2 text-sm font-normal text-mist">“{h.nickname}”</span> : null}</>,
            `${h.nationality ?? ""}${h.nationality ? " · " : ""}${h.record}`))}

          {res.events.length > 0 && head("Events")}
          {res.events.map((e) => row(`e-${e.slug}`, `/schedule/${e.slug}`, <CalendarDays className="size-4" />, e.name, e.city ?? undefined))}

          {res.gyms.length > 0 && head("Gyms")}
          {res.gyms.map((g) => row(`g-${g.slug}`, `/gyms/${g.slug}`,
            <Dumbbell className="size-4 text-volt-400" />,
            <>{g.name}{g.verified ? <BadgeCheck className="ml-1.5 inline size-3.5 align-[-2px] text-volt-400" /> : null}</>,
            [g.place, g.disciplines.join(", "), `${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")))}

          {res.people.length > 0 && head("People")}
          {res.people.map((u) => row(`u-${u.username}`, `/u/${u.username}`,
            <User className="size-4 text-gold-400" />,
            u.name ?? u.username,
            `@${u.username}${u.role && u.role !== "fan" ? ` · ${u.role}` : ""}`))}

          {res.articles.length > 0 && head("News")}
          {res.articles.map((a) => row(`a-${a.slug}`, `/news/${a.slug}`, <Newspaper className="size-4" />, a.title, a.category))}

          {/* Video links to the Watch page filtered by that video's promotion —
              search must not become a fourth place that mounts a player. */}
          {res.videos.length > 0 && head("Videos")}
          {res.videos.map((v) =>
            row(`v-${v.id}`, v.promotion ? `/clips?promotion=${v.promotion}` : "/clips", <Play className="size-4" />, v.title, v.channel),
          )}

          {res.communities.length > 0 && head("Communities")}
          {res.communities.map((c) => row(`c-${c.slug}`, `/community/${c.slug}`, <Users className="size-4" />, c.name))}

          {res.threads.length > 0 && head("Forums")}
          {res.threads.map((t) => row(`t-${t.slug}`, `/forums/${t.categorySlug}/${t.slug}`, <MessagesSquare className="size-4" />, t.title, t.categoryName))}

          {res.pages.length > 0 && head("Pages")}
          {res.pages.map((p) => row(`p-${p.href}-${p.label}`, p.href, <Compass className="size-4" />, p.label))}
        </div>
        <div className="flex items-center justify-between border-t border-ink-700 px-4 py-2 text-[0.7rem] text-fog">
          <span>Search across Combat Reviews</span>
          <span><kbd className="rounded border border-ink-600 px-1.5 py-0.5">ESC</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
