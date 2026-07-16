"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { Flag } from "@/components/flag";

type Hit = { slug: string; name: string; nickname?: string; countryCode?: string; nationality?: string; record: string };

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (value: string) => {
    if (!value.trim()) { setHits([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      setHits((await res.json()).fighters ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const t = setTimeout(() => run(q), 180); return () => clearTimeout(t); }, [q, run]);

  return (
    <div className="container-cr max-w-3xl py-12">
      <h1 className="font-display text-4xl font-bold uppercase text-chalk">Search</h1>
      <p className="mt-2 text-sm text-mist">Search by fighter name, nickname, country, weight division.</p>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4">
        <SearchIcon className="size-5 text-mist" />
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Try “Usyk”, “The Monster”, “Japan”…"
          className="h-14 flex-1 bg-transparent text-base text-chalk outline-none placeholder:text-fog"
        />
        {loading && <Loader2 className="size-4 animate-spin text-mist" />}
      </div>

      <div className="mt-4 divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700">
        {q && !loading && hits.length === 0 && <p className="px-4 py-10 text-center text-sm text-fog">No results for “{q}”.</p>}
        {hits.map((h) => (
          <Link key={h.slug} href={`/fighters/${h.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-800/60">
            <Flag code={h.countryCode} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display font-semibold text-chalk">
                {h.name}{h.nickname ? <span className="ml-2 text-sm font-normal text-mist">“{h.nickname}”</span> : null}
              </p>
              <p className="truncate text-xs text-fog">{h.nationality} · {h.record}</p>
            </div>
            
          </Link>
        ))}
      </div>
    </div>
  );
}
