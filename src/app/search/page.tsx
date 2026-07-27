"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search as SearchIcon, Loader2, CalendarDays, Dumbbell, Shield, User,
} from "lucide-react";
import { Flag } from "@/components/flag";
import { SearchHit, type SearchFollowMaps } from "@/components/search/search-hit";

type FighterHit = {
  slug: string; name: string; nickname?: string | null;
  countryCode?: string | null; nationality?: string | null; record: string;
  image?: string | null; verified?: boolean;
};
type Results = {
  fighters: FighterHit[];
  events: { slug: string; name: string; city: string | null }[];
  gyms: { slug: string; name: string; place: string | null; verified: boolean; memberCount: number; disciplines: string[] }[];
  people: { username: string; name: string | null; image: string | null; role: string; reputation: number }[];
  promotions: { slug: string; name: string }[];
  follow: SearchFollowMaps | null;
};
const EMPTY: Results = { fighters: [], events: [], gyms: [], people: [], promotions: [], follow: null };

/**
 * The full-page search.
 *
 * It used to render FIGHTERS only, from a response that already contained events,
 * gyms, people and more — so the overlay found things this page could not, for the
 * same query. Every followable family renders here now, through the same SearchHit
 * the overlay uses.
 */
export default function SearchPage() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (value: string) => {
    if (!value.trim()) { setRes(EMPTY); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      setRes({ ...EMPTY, ...(await r.json()) });
    } catch {
      setRes(EMPTY);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const t = setTimeout(() => run(q), 180); return () => clearTimeout(t); }, [q, run]);

  const f = res.follow;
  const total =
    res.fighters.length + res.events.length + res.gyms.length +
    res.people.length + res.promotions.length;

  const head = (label: string) => (
    <h2 className="px-3 pb-1 pt-4 font-display text-[0.62rem] font-bold uppercase tracking-widest text-fog">
      {label}
    </h2>
  );

  return (
    <div className="container-cr max-w-3xl py-12">
      <h1 className="font-display text-4xl font-bold uppercase text-chalk">Search</h1>
      <p className="mt-2 text-sm text-mist">
        Fighters, cards, promotions, gyms and people — follow any of them from here.
      </p>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 focus-within:border-blood-500/40">
        <SearchIcon aria-hidden className="size-5 text-mist" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          aria-label="Search fighters, events, promotions, gyms and people"
          placeholder="Try “Usyk”, “The Monster”, “Japan”…"
          className="h-14 flex-1 bg-transparent text-base text-chalk outline-none placeholder:text-fog"
        />
        {loading && <Loader2 aria-hidden className="size-4 animate-spin text-mist" />}
      </div>

      {/* One live region for the whole result set, so a screen reader hears how many
          results a query returned rather than nothing at all. */}
      <p aria-live="polite" className="sr-only">
        {!q ? "" : loading ? "Searching…" : `${total} result${total === 1 ? "" : "s"} for ${q}`}
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-ink-700 p-2">
        {!q && <p className="px-4 py-10 text-center text-sm text-fog">Start typing to search.</p>}
        {q && !loading && total === 0 && (
          <p className="px-4 py-10 text-center text-sm text-fog">No results for “{q}”.</p>
        )}

        {res.fighters.length > 0 && head("Fighters")}
        {res.fighters.map((h) => (
          <SearchHit
            key={h.slug}
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
          />
        ))}

        {res.events.length > 0 && head("Events")}
        {res.events.map((e) => (
          <SearchHit
            key={e.slug}
            href={`/events/${e.slug}`}
            kind="event"
            slug={e.slug}
            name={e.name}
            meta={e.city ?? undefined}
            fallbackIcon={<CalendarDays className="size-4" />}
            following={f?.following.events[e.slug]}
          />
        ))}

        {res.promotions.length > 0 && head("Promotions")}
        {res.promotions.map((p) => (
          <SearchHit
            key={p.slug}
            href={`/events?promotion=${p.slug}`}
            kind="promotion"
            slug={p.slug}
            name={p.name}
            fallbackIcon={<Shield className="size-4 text-blood-300" />}
            following={f?.following.promotions[p.slug]}
            followers={f?.followers.promotions[p.slug]}
          />
        ))}

        {res.gyms.length > 0 && head("Gyms")}
        {res.gyms.map((g) => (
          <SearchHit
            key={g.slug}
            href={`/gyms/${g.slug}`}
            kind="gym"
            slug={g.slug}
            name={g.name}
            verified={g.verified}
            fallbackIcon={<Dumbbell className="size-4 text-volt-400" />}
            meta={[g.place, g.disciplines.join(", ")].filter(Boolean).join(" · ")}
            following={f?.following.gyms[g.slug]}
            followers={f?.followers.gyms[g.slug]}
          />
        ))}

        {res.people.length > 0 && head("People")}
        {res.people.map((u) => (
          <SearchHit
            key={u.username}
            href={`/u/${u.username}`}
            kind="person"
            slug={u.username}
            name={u.name ?? u.username}
            image={u.image}
            fallbackIcon={<User className="size-4 text-gold-400" />}
            meta={`@${u.username}${u.role && u.role !== "fan" ? ` · ${u.role}` : ""}`}
            following={f?.following.people[u.username]}
            followers={f?.followers.people[u.username]}
          />
        ))}
      </div>
    </div>
  );
}
