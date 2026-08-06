"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Search, X, Loader2, Users, CalendarDays, Newspaper, MessagesSquare, Compass, Dumbbell, Shield, User, Play } from "lucide-react";
import { Flag } from "@/components/flag";
import { SearchHit, type SearchFollowMaps } from "@/components/search/search-hit";
import { publicDisplayName } from "@/lib/display-name";
import { useT } from "@/lib/i18n";

type FighterHit = {
  slug: string; name: string; nickname?: string | null;
  countryCode?: string | null; nationality?: string | null; record: string;
  image?: string | null; verified?: boolean;
};
type Results = {
  fighters: FighterHit[];
  events: { slug: string; name: string; city: string | null }[];
  gyms: { slug: string; name: string; place: string | null; verified: boolean; memberCount: number; disciplines: string[] }[];
  people: { username: string; name: string | null; image: string | null; role: string; reputation: number; self?: boolean }[];
  promotions: { slug: string; name: string }[];
  articles: { slug: string; title: string; category: string }[];
  videos: { id: string; title: string; channel: string; promotion: string | null; reason: string }[];
  communities: { slug: string; name: string }[];
  threads: { slug: string; categorySlug: string; title: string; categoryName: string }[];
  pages: { label: string; href: string }[];
  /** Batched follow state + counts for every followable family. Null when unavailable. */
  follow: SearchFollowMaps | null;
};
const EMPTY: Results = {
  fighters: [], events: [], gyms: [], people: [], promotions: [],
  articles: [], communities: [], threads: [], videos: [], pages: [], follow: null,
};

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
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
    res.promotions.length + res.articles.length + res.videos.length +
    res.communities.length + res.threads.length + res.pages.length;

  // Follow state is a batch from the server; absent maps read as "not following",
  // which is the correct rendering for a signed-out reader too.
  const f = res.follow;

  const row = (key: string, href: string, icon: React.ReactNode, title: React.ReactNode, sub?: React.ReactNode) => (
    <Link key={key} href={href} onClick={onClose} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-700/70">
      <span className="grid size-8 shrink-0 place-items-center text-mist">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-semibold text-chalk">{title}</span>
        {sub && <span className="block truncate text-xs text-fog">{sub}</span>}
      </span>
    </Link>
  );

  const head = (label: string) => <p className="px-3 pb-1 pt-3 font-display text-3xs font-bold uppercase tracking-widest text-fog">{label}</p>;

  return (
    // ── Layout ──────────────────────────────────────────────────────────────
    // MOBILE is a full-height sheet, DESKTOP is a floating panel.
    //
    // It used to be one layout for both: `pt-[12vh]` with a `max-h-[60vh]` result
    // list. On a phone that adds up to more than the screen — and the moment the
    // keyboard opens, the visual viewport shrinks by roughly half while the 12vh
    // offset stays measured against the FULL viewport, so the search field itself
    // slid up under the status bar. That is the "top is cut off".
    //
    // `100dvh` rather than `100vh` for the same reason: dvh tracks the *dynamic*
    // viewport, so the sheet resizes with the keyboard instead of being sized
    // against a viewport the user cannot see all of.
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center sm:px-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden shadow-2xl sm:h-auto sm:max-w-2xl sm:rounded-card sm:border sm:border-ink-700 bg-ink-900 sm:card-surface">
        {/* Safe-area padding so the field clears a notch / status bar. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-700 px-4 pt-[env(safe-area-inset-top)] sm:pt-0">
          <Search className="size-5 shrink-0 text-mist" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the whole site — fighters, events, news, communities…"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-chalk outline-none placeholder:text-fog"
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-mist" />}
          {/* The only way out on a phone: there is no Escape key, and tapping the
              backdrop is invisible as an affordance. Bordered and full tap-height
              on mobile so it reads as a button rather than a faint glyph. */}
          <button
            onClick={onClose}
            aria-label="Close search"
            className="cr-touch-target -mr-1.5 grid size-11 shrink-0 place-items-center rounded-lg border border-ink-700 text-mist hover:bg-ink-700 hover:text-chalk sm:size-auto sm:border-0 sm:p-1.5"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Flexes to fill the sheet on mobile; capped on desktop. `overscroll` stops
            a flick past the end from scrolling the page behind the overlay. */}
        <div className="cr-overscroll-contain min-h-0 flex-1 overflow-y-auto p-2 sm:max-h-[60vh] sm:flex-none">
          {!q && <p className="px-4 py-8 text-center text-sm text-fog">Start typing to search across the whole site.</p>}
          {q && !loading && total === 0 && <p className="px-4 py-8 text-center text-sm text-fog">No results for “{q}”.</p>}

          {/* The followable families render through SearchHit — one row with the
              avatar, the verification badge, the follower count and the SAME
              FollowButton the profile pages use, so following from search behaves
              identically to following from anywhere else. */}
          {res.fighters.length > 0 && head("Fighters")}
          {res.fighters.map((h) => (
            <SearchHit
              key={`f-${h.slug}`}
              href={`/fighters/${h.slug}`}
              kind="fighter"
              slug={h.slug}
              name={h.name}
              image={h.image}
              verified={h.verified}
              fallbackIcon={<Flag code={h.countryCode} size="lg" />}
              meta={
                <>
                  {h.nickname ? `“${h.nickname}” · ` : ""}
                  {h.nationality ? `${h.nationality} · ` : ""}
                  {h.record}
                </>
              }
              following={f?.following.fighters[h.slug]}
              followers={f?.followers.fighters[h.slug]}
              onNavigate={onClose}
            />
          ))}

          {res.events.length > 0 && head("Events")}
          {res.events.map((e) => (
            <SearchHit
              key={`e-${e.slug}`}
              href={`/events/${e.slug}`}
              kind="event"
              slug={e.slug}
              name={e.name}
              meta={e.city ?? undefined}
              fallbackIcon={<CalendarDays className="size-4" />}
              following={f?.following.events[e.slug]}
              onNavigate={onClose}
            />
          ))}

          {res.promotions.length > 0 && head("Promotions")}
          {res.promotions.map((p) => (
            <SearchHit
              key={`pr-${p.slug}`}
              // There is no per-promotion page in this app, so the destination is
              // the events list filtered to that organisation — which is what
              // someone searching for "ONE" actually wants. /registry/<slug> would
              // have been a 404: the registry is a single index page.
              href={`/events?promotion=${p.slug}`}
              kind="promotion"
              slug={p.slug}
              name={p.name}
              fallbackIcon={<Shield className="size-4 text-blood-300" />}
              following={f?.following.promotions[p.slug]}
              followers={f?.followers.promotions[p.slug]}
              onNavigate={onClose}
            />
          ))}

          {res.gyms.length > 0 && head("Gyms")}
          {res.gyms.map((g) => (
            <SearchHit
              key={`g-${g.slug}`}
              href={`/gyms/${g.slug}`}
              kind="gym"
              slug={g.slug}
              name={g.name}
              verified={g.verified}
              fallbackIcon={<Dumbbell className="size-4 text-volt-400" />}
              meta={[g.place, g.disciplines.join(", ")].filter(Boolean).join(" · ")}
              following={f?.following.gyms[g.slug]}
              followers={f?.followers.gyms[g.slug]}
              onNavigate={onClose}
            />
          ))}

          {res.people.length > 0 && head("People")}
          {res.people.map((u) => (
            <SearchHit
              key={`u-${u.username}`}
              href={`/u/${u.username}`}
              // No follow control on your OWN row: self-follow is refused by the
              // API, so a button there is a guaranteed dead end.
              kind={u.self ? undefined : "person"}
              slug={u.self ? undefined : u.username}
              name={publicDisplayName(u)}
              image={u.image}
              fallbackIcon={<User className="size-4 text-gold-400" />}
              meta={`@${u.username}${u.role && u.role !== "fan" ? ` · ${u.role}` : ""}`}
              following={f?.following.people[u.username]}
              followers={f?.followers.people[u.username]}
              onNavigate={onClose}
            />
          ))}

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
        {/* Keyboard hints are DESKTOP ONLY. A phone has no Escape key and no "/"
            shortcut, so both lines were instructions the reader could not follow —
            and the ESC one was actively misleading, since the X button beside the
            field is the actual way out there. The whole footer is hidden on mobile
            rather than reworded: it exists to teach shortcuts, and there are none
            to teach on a touch device. */}
        <div className="hidden shrink-0 items-center justify-between border-t border-ink-700 px-4 py-2 text-2xs text-fog sm:flex">
          <span>
            {t("Press")} <kbd className="rounded border border-ink-600 px-1.5 py-0.5">/</kbd> {t("anywhere to search")}
          </span>
          <span><kbd className="rounded border border-ink-600 px-1.5 py-0.5">ESC</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
