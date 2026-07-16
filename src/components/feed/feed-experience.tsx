"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Play, Film, Heart, Bookmark, Share2, Flame, Clock, Sparkles, X, Library, Menu, ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TOPICS_META, TOPIC_LABEL, contentPill } from "@/lib/feed/tags";
import { ReelsOverlay } from "./reels-overlay";
import { SaveSheet } from "./save-sheet";
import { fetchLibrary } from "./library-client";
import {
  getClientId, fmtViews, fmtDuration, timeAgo, cleanTitle, isNewToday, INTENT_WORDS, SMART_CHIPS, type FeedVideo,
} from "./client";

type Sort = "smart" | "top" | "new";
const SORTS: { id: Sort; label: string; icon: typeof Flame }[] = [
  { id: "smart", label: "Smart", icon: Sparkles },
  { id: "top", label: "Top", icon: Flame },
  { id: "new", label: "New", icon: Clock },
];

export function FeedExperience() {
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [intent, setIntent] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("smart");
  const [reelsOpen, setReelsOpen] = useState(false);
  const [modal, setModal] = useState<FeedVideo | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saveFor, setSaveFor] = useState<FeedVideo | null>(null);
  const cid = useRef("anon");
  const token = useRef(0);

  const queryObj = useMemo(() => {
    const o: Record<string, string> = { sort };
    if (topics.size) o.topics = [...topics].join(",");
    if (intent) o.intent = intent;
    if (q) o.q = q;
    return o;
  }, [sort, topics, intent, q]);

  const load = useCallback(async () => {
    const t = ++token.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ ...queryObj, cid: cid.current });
      const res = await fetch(`/api/feed?${p.toString()}`);
      const data = (await res.json()) as { videos: FeedVideo[]; count: number };
      if (t !== token.current) return;
      setVideos(data.videos || []);
      setCount(data.count || 0);
    } catch { /* noop */ }
    finally { if (t === token.current) setLoading(false); }
  }, [queryObj]);

  useEffect(() => { cid.current = getClientId(); }, []);
  useEffect(() => { fetchLibrary().then((d) => setSavedIds(new Set(d.savedIds))); }, []);
  // The feed renders in-flow inside the global app shell (bottom tab bar stays
  // visible). Reels is an explicit full-screen mode opened via the Reels button,
  // so we no longer auto-open it on mobile load.
  useEffect(() => { const id = setTimeout(load, 180); return () => clearTimeout(id); }, [load]);

  const onSearch = (val: string) => {
    const t = val.trim();
    if (t && INTENT_WORDS.test(t)) { setIntent(t); setQ(""); }
    else { setQ(t); setIntent(""); }
  };
  const toggleTopic = (id: string) =>
    setTopics((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSmart = (val: string) => { setIntent((cur) => (cur === val ? "" : val)); setQ(""); };

  return (
    <div className="container-cr py-6 lg:py-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-chalk lg:text-3xl">Combat Feed</h1>
          <p className="mt-1 text-sm text-mist">Today’s best fights across every discipline.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/library"
            className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800/40 px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-chalk transition-colors hover:border-blood-500/60 hover:bg-ink-700/60"
          >
            <Library className="size-4" /> Library
          </Link>
          <button
            onClick={() => setReelsOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blood-500 px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-[0_8px_30px_-12px_rgba(225,29,42,0.8)] transition-colors hover:bg-blood-400"
          >
            <Film className="size-4" /> Reels
          </button>
        </div>
      </div>

      {/* Search (natural language) */}
      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fog" />
        <input
          type="search"
          defaultValue=""
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search or ask — “only KOs”, “no boxing”"
          className="w-full rounded-xl border border-ink-700 bg-ink-850/60 py-2.5 pl-10 pr-4 text-sm text-chalk outline-none transition-colors placeholder:text-fog focus:border-blood-500/60"
        />
      </div>

      {/* Filters (dropdown) + sort */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 pb-4">
        <FilterMenu
          topics={topics}
          intent={intent}
          onToggleTopic={toggleTopic}
          onClearTopics={() => setTopics(new Set())}
          onToggleSmart={toggleSmart}
          onClearAll={() => { setTopics(new Set()); setIntent(""); setQ(""); }}
        />
        <div className="flex shrink-0 rounded-full border border-ink-700 bg-ink-850/60 p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
                sort === s.id ? "bg-blood-500 text-white" : "text-mist hover:text-chalk",
              )}
            >
              <s.icon className="size-3.5" /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="mb-4 text-xs text-fog">
        {loading ? "Loading…" : `${count} fights · ${{ smart: "ranked for you", top: "most viewed", new: "newest first" }[sort]}`}
      </div>

      {/* Grid */}
      {loading && videos.length === 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : videos.length === 0 ? (
        <div className="py-20 text-center text-mist">No fights match these filters. Try loosening them.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((v) => (
            <FeedCard key={v.id} v={v} onPlay={() => setModal(v)} saved={savedIds.has(v.id)} onSave={() => setSaveFor(v)} />
          ))}
        </div>
      )}

      <ReelsOverlay open={reelsOpen} onClose={() => setReelsOpen(false)} query={queryObj} />
      {modal && <PlayerModal v={modal} onClose={() => setModal(null)} />}
      {saveFor && (
        <SaveSheet
          video={saveFor}
          onClose={() => setSaveFor(null)}
          onSaved={(id) => setSavedIds((s) => new Set(s).add(id))}
        />
      )}
    </div>
  );
}

function FilterMenu({
  topics, intent, onToggleTopic, onClearTopics, onToggleSmart, onClearAll,
}: {
  topics: Set<string>;
  intent: string;
  onToggleTopic: (id: string) => void;
  onClearTopics: () => void;
  onToggleSmart: (val: string) => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = topics.size + (intent ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
          open || activeCount
            ? "border-blood-500/60 bg-ink-800/60 text-chalk"
            : "border-ink-700 bg-ink-850/60 text-mist hover:border-ink-600 hover:text-chalk",
        )}
      >
        <Menu className="size-4" />
        Filters
        {activeCount > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-blood-500 text-[0.6rem] font-bold text-white">{activeCount}</span>
        )}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-[min(92vw,22rem)] rounded-card border border-ink-700 bg-ink-900 p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[0.62rem] font-bold uppercase tracking-widest text-fog">Discipline</span>
            {activeCount > 0 && (
              <button onClick={onClearAll} className="text-[0.7rem] font-semibold text-mist transition-colors hover:text-blood-400">Clear all</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip small active={topics.size === 0} onClick={onClearTopics}>All</Chip>
            {TOPICS_META.map((t) => (
              <Chip key={t.id} small active={topics.has(t.id)} onClick={() => onToggleTopic(t.id)}>{t.label}</Chip>
            ))}
          </div>

          <div className="mb-2 mt-4 text-[0.62rem] font-bold uppercase tracking-widest text-fog">Focus</div>
          <div className="flex flex-wrap gap-2">
            {SMART_CHIPS.map((c) => (
              <Chip key={c.intent} small active={intent === c.intent} onClick={() => onToggleSmart(c.intent)}>{c.label}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-card border border-ink-700 bg-ink-900">
      <div className="cr-shimmer aspect-video w-full" />
      <div className="space-y-2.5 p-3.5">
        <div className="cr-shimmer h-3.5 w-11/12 rounded" />
        <div className="cr-shimmer h-3.5 w-3/5 rounded" />
        <div className="cr-shimmer mt-3 h-3 w-2/5 rounded" />
      </div>
    </div>
  );
}

function Chip({ children, active, onClick, small }: { children: React.ReactNode; active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border font-display font-semibold uppercase tracking-wide transition-colors",
        small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-[0.8rem]",
        active
          ? "border-blood-500 bg-blood-500 text-white"
          : "border-ink-700 bg-ink-850/60 text-mist hover:border-ink-600 hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

function FeedCard({ v, onPlay, saved, onSave }: { v: FeedVideo; onPlay: () => void; saved: boolean; onSave: () => void }) {
  const pill = contentPill(v.tags || []);
  const dur = fmtDuration(v);
  const [failed, setFailed] = useState(false);
  return (
    <article className="group overflow-hidden rounded-card border border-ink-700 bg-ink-900 transition-all hover:-translate-y-1 hover:border-blood-500/50 hover:shadow-glow-red">
      <button onClick={onPlay} className="relative block aspect-video w-full overflow-hidden bg-ink-800 text-left">
        {!failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center p-4 text-center text-xs text-mist">{cleanTitle(v.title)}</div>
        )}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex size-14 items-center justify-center rounded-full border border-white/25 bg-white/15 backdrop-blur-md">
            <Play className="ml-0.5 size-5 fill-white text-white" />
          </span>
        </span>
        <div className="absolute inset-x-3 top-3 flex items-start gap-1.5">
          {isNewToday(v.publishedAt) && (
            <span className="rounded-md bg-blood-500 px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-widest text-white shadow-glow-red">New</span>
          )}
          {pill && (
            <span className={cn("rounded-md border px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider backdrop-blur-sm",
              pill[1] ? "border-transparent bg-blood-500/90 text-white" : "border-white/15 bg-black/55 text-chalk")}>{pill[0]}</span>
          )}
          <span className="ml-auto rounded-md border-0 bg-black/60 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-chalk backdrop-blur-sm">{TOPIC_LABEL[v.topic ?? ""] ?? v.topic}</span>
        </div>
        {dur && <span className="absolute bottom-3 right-3 rounded bg-black/80 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">{dur}</span>}
      </button>
      <div className="p-3.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-chalk">{cleanTitle(v.title)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-mist">
          <span className="font-semibold text-chalk/80">{cleanTitle(v.channel)}</span>
          {v.viewCount ? <><span className="text-fog">·</span><span>{fmtViews(v.viewCount)}</span></> : null}
          <span className="text-fog">·</span><span>{timeAgo(v.publishedAt)}</span>
        </div>
        <div className="mt-3 flex items-center gap-1 border-t border-ink-800 pt-2.5 text-mist">
          <button onClick={onPlay} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-ink-800 hover:text-chalk">
            <Heart className="size-4" /> Respect
          </button>
          <button
            onClick={onSave}
            aria-pressed={saved}
            className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-ink-800 hover:text-chalk", saved && "text-blood-400")}
          >
            <Bookmark className={cn("size-4", saved && "fill-blood-500 text-blood-500")} /> {saved ? "Saved" : "Save"}
          </button>
          <button onClick={() => share(v)} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-ink-800 hover:text-chalk">
            <Share2 className="size-4" /> Share
          </button>
        </div>
      </div>
    </article>
  );
}

function PlayerModal({ v, onClose }: { v: FeedVideo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="line-clamp-1 font-display font-semibold text-chalk">{cleanTitle(v.title)}</p>
          <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-chalk"><X className="size-5" /></button>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-card border border-ink-700 bg-black">
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

function share(v: FeedVideo) {
  const url = `https://www.youtube.com/watch?v=${v.id}`;
  if (navigator.share) { navigator.share({ title: v.title, text: v.title, url }).catch(() => {}); return; }
  navigator.clipboard?.writeText(url).catch(() => {});
}
