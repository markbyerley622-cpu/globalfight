"use client";

import { useEffect, useState } from "react";
import {
  Radio, CheckCircle2, AlertTriangle, XCircle, CircleSlash, Clock, Database,
} from "lucide-react";
import { PageHero } from "@/components/page-hero";
import type { ProviderHealthReport, ProviderRow, ProviderState } from "@/lib/admin/provider-health";
import type { LadderStatus } from "@/lib/scraper/coverage-ladder";

const STATE: Record<ProviderState, { icon: typeof Radio; text: string; ring: string; label: string }> = {
  healthy: { icon: CheckCircle2, text: "text-up", ring: "border-up/30 bg-up/5", label: "Healthy" },
  stale: { icon: AlertTriangle, text: "text-gold-300", ring: "border-gold-500/40 bg-gold-500/5", label: "Stale" },
  silent: { icon: XCircle, text: "text-blood-400", ring: "border-blood-500/40 bg-blood-500/5", label: "Silent" },
  disabled: { icon: CircleSlash, text: "text-fog", ring: "border-ink-700 bg-ink-900/40", label: "Disabled" },
  "never-run": { icon: Clock, text: "text-mist", ring: "border-ink-700 bg-ink-900/40", label: "Never run" },
};

const LADDER: Record<LadderStatus, string> = {
  live: "text-up",
  supported: "text-volt-400",
  thin: "text-gold-300",
  "no-source": "text-fog",
  blocked: "text-blood-400",
  unprobed: "text-mist",
};

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export default function ProvidersPage() {
  const [data, setData] = useState<ProviderHealthReport | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  const load = async () => {
    try {
      const res = await fetch("/api/admin/providers", { cache: "no-store" });
      if (res.status === 403) { setState("forbidden"); return; }
      if (!res.ok) { setState("error"); return; }
      setData(await res.json());
      setState("ok");
    } catch { setState("error"); }
  };

  useEffect(() => { void load(); }, []);

  if (state === "forbidden") return <Shell><p className="text-sm text-fog">Admins only.</p></Shell>;
  if (state === "error") return <Shell><p className="text-sm text-blood-300">Could not load provider health.</p></Shell>;
  if (!data) return <Shell><p className="text-sm text-fog">Loading…</p></Shell>;

  return (
    <Shell>
      {/* The master gate first. Every provider below is irrelevant if this is off,
          and that has cost a wrong diagnosis before — see cron-handler. */}
      <div className={`mb-5 rounded-xl border p-4 ${data.scraperEnabled ? "border-up/30 bg-up/5" : "border-blood-500/40 bg-blood-500/5"}`}>
        <p className="font-display text-sm font-bold text-chalk">
          ENABLE_SCRAPER is {data.scraperEnabled ? "ON" : "OFF"}
        </p>
        <p className="mt-1 text-xs text-fog">
          {data.scraperEnabled
            ? "Providers may reach the network. Each still needs its own flag."
            : "No provider can fetch anything, whatever its own flag says. Every job below will report zero."}
          {" "}Backfill mode is {data.backfillEnabled ? "enabled" : "disabled"}.
        </p>
      </div>

      {/* ── Providers ─────────────────────────────────────────────────────── */}
      <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-fog">Providers</h2>
      <div className="mb-8 overflow-x-auto rounded-xl border border-ink-800">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-ink-900/60 text-left text-[0.68rem] uppercase tracking-wider text-fog">
            <tr>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2 text-right">Bouts</th>
              <th className="px-3 py-2 text-right">Empty</th>
              <th className="px-3 py-2 text-right">Last write</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {data.providers.map((p) => <Row key={p.source} p={p} />)}
          </tbody>
        </table>
      </div>

      {/* ── The combat graph ──────────────────────────────────────────────── */}
      <h2 className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-fog">Canonical combat graph</h2>
      <p className="mb-3 text-xs text-fog">
        Ruleset coverage gates everything downstream — a discipline is only as
        good as the bout evidence behind it.
      </p>
      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-4">
          <p className="font-display text-2xl font-black tabular-nums text-chalk">
            {pct(data.graph.boutsWithRuleset, data.graph.bouts)}%
          </p>
          <p className="text-xs text-mist tabular-nums">
            {data.graph.boutsWithRuleset.toLocaleString()} of {data.graph.bouts.toLocaleString()} bouts have a verified ruleset
          </p>
          <p className="mt-3 text-[0.68rem] font-bold uppercase tracking-wider text-fog">Remaining UNKNOWN, by promotion</p>
          <ul className="mt-1 space-y-0.5">
            {data.graph.unknownByPromotion.map((u) => (
              <li key={u.promotion} className="flex justify-between text-xs text-mist">
                <span className="truncate">{u.promotion}</span>
                <span className="tabular-nums">{u.bouts.toLocaleString()}</span>
              </li>
            ))}
            {data.graph.unknownByPromotion.length === 0 && (
              <li className="text-xs text-up">Every bout has a ruleset.</li>
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-4">
          <p className="font-display text-2xl font-black tabular-nums text-chalk">
            {data.graph.fightersCalculated.toLocaleString()}
            <span className="text-sm font-bold text-fog"> / {data.graph.fighters.toLocaleString()}</span>
          </p>
          <p className="text-xs text-mist">
            fighters with a persisted discipline graph ·{" "}
            <span className="text-chalk">{data.graph.multiDiscipline.toLocaleString()}</span> multi-discipline
          </p>
          <p className="mt-3 text-[0.68rem] font-bold uppercase tracking-wider text-fog">Confidence</p>
          <ul className="mt-1 space-y-0.5">
            {data.graph.tiers.map((t) => (
              <li key={t.tier} className="flex justify-between text-xs">
                <span className={t.tier === "HIGH" ? "text-up" : t.tier === "LOW" ? "text-gold-300" : "text-mist"}>{t.tier}</span>
                <span className="tabular-nums text-mist">
                  {t.fighters.toLocaleString()} ({pct(t.fighters, data.graph.fighters)}%)
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.68rem] font-bold uppercase tracking-wider text-fog">
            Fighters per discipline <span className="font-normal normal-case">(crossovers count in each)</span>
          </p>
          <ul className="mt-1 grid grid-cols-2 gap-x-4">
            {data.graph.perDiscipline.map((d) => (
              <li key={d.sport} className="flex justify-between text-xs text-mist">
                <span className="truncate">{d.sport.replace(/_/g, " ")}</span>
                <span className="tabular-nums">{d.fighters.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Coverage ──────────────────────────────────────────────────────── */}
      <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-fog">
        <Database className="size-3.5" /> Coverage by sport
      </h2>
      <div className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.coverage.map((c) => (
          <div key={c.sport} className="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
            <p className="font-display text-sm font-bold text-chalk">{c.sport.replace(/_/g, " ")}</p>
            <p className="mt-0.5 text-xs text-mist tabular-nums">
              {c.events.toLocaleString()} events · {c.bouts.toLocaleString()} bouts
            </p>
            <p className="text-[0.68rem] text-fog tabular-nums">
              {c.withBouts} with a card ({c.events ? Math.round((c.withBouts / c.events) * 100) : 0}%)
            </p>
          </div>
        ))}
      </div>

      {/* ── The ladder ────────────────────────────────────────────────────── */}
      <h2 className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-fog">Source ladder</h2>
      <p className="mb-3 text-xs text-fog">
        What each organisation actually publishes, and when it was checked. A
        &ldquo;no-source&rdquo; is a finished piece of work, not a to-do.
      </p>
      <ul className="space-y-2">
        {data.ladder.map((l) => (
          <li key={`${l.org}-${l.sport}`} className="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-sm font-bold text-chalk">{l.org}</span>
              <span className={`text-[0.65rem] font-bold uppercase tracking-wider ${LADDER[l.status]}`}>{l.status}</span>
              <span className="text-[0.65rem] text-fog">{l.sport.replace(/_/g, " ")}</span>
              {l.checked && <span className="ml-auto text-[0.65rem] tabular-nums text-fog">checked {l.checked}</span>}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-mist">{l.evidence}</p>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Row({ p }: { p: ProviderRow }) {
  const s = STATE[p.state];
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <p className="font-display text-sm font-bold text-chalk">{p.label}</p>
        <p className="text-[0.68rem] text-fog">
          <code>{p.source}</code> · {String(p.sport).replace(/_/g, " ")}
          {p.enabled === false && " · flag OFF"}
        </p>
        <p className="mt-0.5 text-[0.68rem] leading-snug text-mist">{p.note}</p>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[0.65rem] font-bold uppercase tracking-wider ${s.ring} ${s.text}`}>
          <s.icon className="size-3" /> {s.label}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-chalk">{p.events.toLocaleString()}</td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-chalk">{p.bouts.toLocaleString()}</td>
      <td className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${p.emptyCards > 0 ? "text-gold-300" : "text-fog"}`}>
        {p.emptyCards.toLocaleString()}
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-mist">
        {p.daysSinceWrite === null ? "—" : p.daysSinceWrite === 0 ? "today" : `${p.daysSinceWrite}d ago`}
      </td>
    </tr>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHero
        eyebrow="Admin"
        title="Providers"
        description="What each ingestion source has actually written — and the evidence behind every source not yet built."
      />
      <div className="container-cr py-6">{children}</div>
    </>
  );
}
