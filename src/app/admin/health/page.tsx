"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, HeartPulse, AlertOctagon, AlertTriangle, Info, ArrowRight, RefreshCw, Wrench, GitMerge, ImageDown, Trophy, ListOrdered } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import type { DataHealthReport, HealthCheck, Severity } from "@/lib/admin/data-health";

const SEV: Record<Severity, { icon: typeof Info; ring: string; text: string; label: string }> = {
  critical: { icon: AlertOctagon, ring: "border-blood-500/40 bg-blood-500/5", text: "text-blood-400", label: "Critical" },
  warn: { icon: AlertTriangle, ring: "border-gold-500/40 bg-gold-500/5", text: "text-gold-300", label: "Warning" },
  info: { icon: Info, ring: "border-ink-700 bg-ink-900/40", text: "text-mist", label: "Info" },
};

export default function DataHealthPage() {
  const [data, setData] = useState<DataHealthReport | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  const load = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (res.status === 403) return setState("forbidden");
      if (!res.ok) return setState("error");
      setData(await res.json());
      setState("ok");
    } catch { setState("error"); }
  };
  useEffect(() => { load(); }, []);

  if (state === "forbidden") {
    return (
      <>
        <PageHero eyebrow="Admin" title="Data Health" />
        <div className="container-cr py-16 text-center">
          <ShieldCheck className="mx-auto mb-3 size-10 text-ink-600" />
          <p className="font-display text-lg font-bold text-chalk">Admins only</p>
        </div>
      </>
    );
  }

  const criticals = data?.checks.filter((c) => c.severity === "critical").length ?? 0;
  const clean = state === "ok" && data && data.checks.length === 0;

  return (
    <>
      <PageHero
        eyebrow="Admin"
        title="Data Health"
        description="Every missing photo, poster, record, provenance gap and duplicate in one place — with links to fix them."
      />
      <div className="container-cr space-y-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {data && (
            <div className="flex flex-wrap gap-2 text-xs text-fog">
              <Stat label="Fighters" value={data.totals.fighters} />
              <Stat label="Events" value={data.totals.events} />
              <Stat label="Rankings" value={data.totals.rankings} />
              {criticals > 0 && <span className="inline-flex items-center gap-1 rounded-lg bg-blood-500/15 px-2.5 py-1 font-semibold text-blood-300"><AlertOctagon className="size-3.5" />{criticals} critical</span>}
            </div>
          )}
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-1.5 text-xs font-semibold text-mist transition-colors hover:text-chalk">
            <RefreshCw className={`size-3.5 ${state === "loading" ? "animate-spin" : ""}`} /> Re-scan
          </button>
        </div>

        <OpsConsole onDone={load} />

        {state === "loading" && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-card bg-ink-850/60" />)}</div>}
        {state === "error" && <p className="card-surface p-6 text-center text-sm text-blood-300">Failed to run the audit. Re-scan to retry.</p>}

        {clean && (
          <div className="card-surface flex flex-col items-center gap-2 p-12 text-center">
            <HeartPulse className="size-10 text-volt-400" />
            <p className="font-display text-lg font-bold text-chalk">All clear</p>
            <p className="max-w-sm text-sm text-fog">No data-health issues detected across fighters, events and rankings.</p>
          </div>
        )}

        {state === "ok" && data && data.checks.map((c) => <CheckCard key={c.id} check={c} />)}

        {data && <p className="text-center text-[0.7rem] text-fog">Scanned {new Date(data.generatedAt).toLocaleString()}</p>}
      </div>
    </>
  );
}

const OPS = [
  { action: "enrich-photos", label: "Enrich photos", icon: ImageDown, hint: "Pull licensed photos for upcoming-card fighters first (batch of 50)." },
  { action: "enrich-article-images", label: "Article images", icon: ImageDown, hint: "Fetch OpenGraph images for news articles that have none (batch of 50)." },
  { action: "repair-duplicates", label: "Merge duplicates", icon: GitMerge, hint: "Merge same-name fighters into the most-complete record (data-preserving)." },
  { action: "refresh-p4p", label: "Refresh P4P", icon: Trophy, hint: "Re-ingest curated P4P + regenerate rating-engine P4P." },
  { action: "refresh-rankings", label: "Refresh rankings", icon: ListOrdered, hint: "Run every licensed ranking connector." },
] as const;

/** One-click maintenance. Each button runs a real, idempotent job then re-scans. */
function OpsConsole({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [last, setLast] = useState<{ action: string; ok: boolean; summary: string } | null>(null);

  const run = async (action: string) => {
    setRunning(action);
    setLast(null);
    try {
      const res = await fetch("/api/admin/ops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      setLast({ action, ok: !!data.ok, summary: data.ok ? summarize(action, data.result) : (data.error ?? "failed") });
      if (data.ok) onDone();
    } catch {
      setLast({ action, ok: false, summary: "request failed" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <section className="rounded-card border border-ink-700 bg-ink-900/40 p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-tight text-chalk">
        <Wrench className="size-4 text-blood-400" /> Operations Console
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {OPS.map((op) => {
          const Icon = op.icon;
          const busy = running === op.action;
          return (
            <button
              key={op.action}
              onClick={() => run(op.action)}
              disabled={running !== null}
              title={op.hint}
              className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2.5 text-left text-xs font-semibold text-mist transition-colors hover:border-blood-500/50 hover:text-chalk disabled:opacity-50"
            >
              <Icon className={`size-4 shrink-0 ${busy ? "animate-pulse text-blood-400" : "text-fog"}`} />
              {busy ? "Running…" : op.label}
            </button>
          );
        })}
      </div>
      {last && (
        <p className={`mt-3 text-xs ${last.ok ? "text-volt-300" : "text-blood-300"}`}>
          {last.ok ? "✓" : "✗"} {last.action}: {last.summary}
        </p>
      )}
    </section>
  );
}

function summarize(action: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (action === "repair-duplicates") return `${r.merged ?? 0} merged across ${r.groups ?? 0} groups`;
  if (action === "enrich-photos") return `${(r as { photos?: number }).photos ?? 0} photos from ${(r as { scanned?: number }).scanned ?? 0} scanned`;
  return "done";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-800 bg-ink-900/50 px-2.5 py-1">
      <span className="font-display font-bold text-chalk">{value.toLocaleString()}</span>
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  );
}

function CheckCard({ check }: { check: HealthCheck }) {
  const sev = SEV[check.severity];
  const Icon = sev.icon;
  return (
    <section className={`rounded-card border p-4 ${sev.ring}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <Icon className={`mt-0.5 size-5 shrink-0 ${sev.text}`} />
          <div>
            <h2 className="font-display text-base font-bold text-chalk">{check.label}</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-fog">{check.hint}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 font-display text-lg font-black ${sev.text}`}>{check.count.toLocaleString()}</span>
      </div>
      {check.samples.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-800/60 pt-3">
          {check.samples.map((s, i) => (
            <Link key={i} href={s.href} className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-950/40 px-2 py-1 text-[0.7rem] text-mist transition-colors hover:border-blood-500/50 hover:text-chalk">
              {s.label} <ArrowRight className="size-3 opacity-60" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
