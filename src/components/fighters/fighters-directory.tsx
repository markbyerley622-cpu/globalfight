"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Flag } from "@/components/flag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { useT } from "@/lib/i18n";
import { SPORTS, SPORT_LABEL, formatSportRecord } from "@/lib/sports";
import type { FighterListItem } from "@/lib/types";
import type { Paginated } from "@/lib/forum/types";

type Item = FighterListItem;
const LIMIT = 10;

export function FightersDirectory() {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);

  // Cursor history → prev/next paging without loading everything.
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [sport, setSport] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");
  const qDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildQuery = useCallback((cursor?: string) => {
    const p = new URLSearchParams();
    if (sport) p.set("sport", sport);
    if (country) p.set("country", country);
    if (status) p.set("status", status);
    if (qLive) p.set("q", qLive);
    p.set("limit", String(LIMIT));
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }, [sport, country, status, qLive]);

  const fetchAt = useCallback(async (cursor?: string) => {
    const res = await fetch(`/api/fighters?${buildQuery(cursor)}`, { cache: "no-store" });
    return (await res.json()) as Paginated<Item>;
  }, [buildQuery]);

  // Reset to page 1 whenever filters change.
  const reset = useCallback(async () => {
    setLoading(true);
    const data = await fetchAt(undefined);
    setItems(data.items);
    setNextCursor(data.nextCursor);
    setHistory([undefined]);
    setPageIndex(0);
    setLoading(false);
  }, [fetchAt]);

  useEffect(() => { reset(); }, [reset]);

  useEffect(() => {
    fetch("/api/fighters/countries").then((r) => r.json()).then((d) => setCountries(d.countries ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (qDebounce.current) clearTimeout(qDebounce.current);
    qDebounce.current = setTimeout(() => setQLive(q.trim()), 300);
    return () => { if (qDebounce.current) clearTimeout(qDebounce.current); };
  }, [q]);

  async function goNext() {
    if (!nextCursor) return;
    const cur = nextCursor;
    setLoading(true);
    const data = await fetchAt(cur);
    setItems(data.items);
    setNextCursor(data.nextCursor);
    setHistory((h) => [...h.slice(0, pageIndex + 1), cur]);
    setPageIndex((i) => i + 1);
    setLoading(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function goPrev() {
    if (pageIndex === 0) return;
    setLoading(true);
    const data = await fetchAt(history[pageIndex - 1]);
    setItems(data.items);
    setNextCursor(data.nextCursor);
    setPageIndex((i) => i - 1);
    setLoading(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const hasFilters = !!(sport || country || status || q);
  function clearFilters() { setSport(""); setCountry(""); setStatus(""); setQ(""); }

  const sportOpts = SPORTS.map((s) => ({ value: s.value, label: s.label }));
  const countryOpts = countries.map((c) => ({ value: c.code, label: c.name }));
  const statusOpts = [{ value: "active", label: t("Active") }, { value: "inactive", label: t("Inactive") }];

  return (
    <div>
      {/* Filters */}
      <div className="mb-5 space-y-2">
        <label className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/50 px-3 focus-within:border-blood-500/50">
          <Search className="size-4 text-fog" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search name, gym, nationality…")}
            className="h-11 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
          />
          {q && <button onClick={() => setQ("")} aria-label="Clear"><X className="size-4 text-fog hover:text-chalk" /></button>}
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <FilterSelect value={sport} onChange={setSport} options={sportOpts} placeholder={t("All sports")} />
          <FilterSelect value={country} onChange={setCountry} options={countryOpts} placeholder={t("All countries")} searchable />
          <FilterSelect value={status} onChange={setStatus} options={statusOpts} placeholder={t("Any status")} />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-blood-400 hover:text-blood-300">
            <X className="size-3.5" /> {t("Clear filters")}
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-card border border-ink-700 lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-900/60 text-left text-[0.65rem] uppercase tracking-wider text-fog">
              <th className="px-4 py-3 font-semibold">{t("Name")}</th>
              <th className="px-4 py-3 font-semibold">{t("Sport")}</th>
              <th className="px-4 py-3 font-semibold">{t("Record")}</th>
              <th className="px-4 py-3 font-semibold">{t("Nationality")}</th>
              <th className="px-4 py-3 font-semibold">{t("Residence")}</th>
              <th className="px-4 py-3 font-semibold">{t("Status")}</th>
              <th className="px-4 py-3 font-semibold">{t("Profile")}</th>
              <th className="px-4 py-3 font-semibold">{t("Website")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {loading
              ? Array.from({ length: LIMIT }).map((_, i) => <SkeletonRow key={i} />)
              : items.map((f) => <Row key={f.slug} f={f} t={t} />)}
          </tbody>
        </table>
        {!loading && items.length === 0 && <EmptyState t={t} />}
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 lg:hidden">
        {loading
          ? Array.from({ length: LIMIT }).map((_, i) => <div key={i} className="h-[4.5rem] animate-pulse rounded-card bg-ink-850/60" />)
          : items.length === 0
            ? <EmptyState t={t} />
            : items.map((f) => <MobileCard key={f.slug} f={f} t={t} />)}
      </div>

      {/* Prev / Next pager */}
      {(pageIndex > 0 || nextCursor) && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={goPrev} disabled={pageIndex === 0 || loading}>
            <ChevronLeft className="size-4" /> {t("Previous")}
          </Button>
          <span className="text-sm text-fog">{t("Page")} {pageIndex + 1}</span>
          <Button variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>
            {t("Next")} <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function WebsiteCell({ f, t }: { f: Item; t: (k: string) => string }) {
  if (f.website) {
    return <a href={f.website} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-volt-400 hover:text-volt-300">{t("Visit")}</a>;
  }
  return <Link href={`/fighters/${f.slug}?claim=website`} className="text-xs font-semibold text-blood-400 hover:text-blood-300">{t("Claim")}</Link>;
}

function Row({ f, t }: { f: Item; t: (k: string) => string }) {
  return (
    <tr className="hover:bg-ink-800/40">
      <td className="px-4 py-2.5">
        <Link href={`/fighters/${f.slug}`} className="flex items-center gap-3 font-display font-semibold text-chalk hover:text-blood-300">
          <FighterAvatar fighter={f} size="sm" />
          <span className="min-w-0"><span className="block truncate">{f.name}</span>{f.nickname && <span className="block truncate text-xs font-normal text-fog">&ldquo;{f.nickname}&rdquo;</span>}</span>
        </Link>
      </td>
      <td className="px-4 py-2.5 text-mist">
        <span className="flex items-center gap-1.5">
          {SPORT_LABEL[f.sport] ?? f.sport}
          {f.promoter && <Badge tone="red">{f.promoter}</Badge>}
        </span>
      </td>
      <td className="px-4 py-2.5 tabular-nums text-mist">{formatSportRecord(f)}</td>
      <td className="px-4 py-2.5 text-mist"><span className="flex items-center gap-1.5">{f.countryCode && <Flag code={f.countryCode} />}{f.nationality ?? "—"}</span></td>
      <td className="px-4 py-2.5 text-mist">{f.residence ?? "—"}</td>
      <td className="px-4 py-2.5"><Badge tone={f.active ? "volt" : "neutral"}>{f.active ? t("Active") : t("Inactive")}</Badge></td>
      <td className="px-4 py-2.5"><Link href={`/fighters/${f.slug}`} className="text-xs font-semibold text-blood-400 hover:text-blood-300">{t("View")}</Link></td>
      <td className="px-4 py-2.5"><WebsiteCell f={f} t={t} /></td>
    </tr>
  );
}

function MobileCard({ f, t }: { f: Item; t: (k: string) => string }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-ink-700 bg-ink-900/40 p-3">
      <Link href={`/fighters/${f.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        <FighterAvatar fighter={f} size="md" showFlag />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-chalk">{f.name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-fog">{[SPORT_LABEL[f.sport] ?? f.sport, formatSportRecord(f)].filter(Boolean).join(" · ")} {f.promoter && <Badge tone="red">{f.promoter}</Badge>}</p>
          <p className="truncate text-xs text-fog">{f.nationality ?? "—"}{f.residence ? ` · ${f.residence}` : ""}</p>
        </div>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge tone={f.active ? "volt" : "neutral"}>{f.active ? t("Active") : t("Inactive")}</Badge>
        <WebsiteCell f={f} t={t} />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-ink-800" /></td>
      ))}
    </tr>
  );
}

function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <div className="p-10 text-center">
      <p className="font-display font-semibold text-chalk">{t("No fighters found")}</p>
      <p className="mt-1 text-sm text-fog">{t("Try adjusting your filters, or add your fighter profile.")}</p>
      <Link href="/account" className="mt-4 inline-block rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white hover:bg-blood-400">
        {t("Add your profile")}
      </Link>
    </div>
  );
}
