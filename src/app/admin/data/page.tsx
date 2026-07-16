"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle, Database, Activity, AlertTriangle } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";

interface ProviderRow { key: string; label: string; sports: string[]; configured: boolean }
interface CoverageRow { sport: string; label: string; sources: string[] }
interface SyncRow {
  id: string; sourceKey: string; sport: string | null; entity: string; status: string;
  imported: number; failures: number; rateLimitHits: number; durationMs: number | null;
  fellBackTo: string | null; startedAt: string;
}
interface HealthRow { sourceKey: string; last: { ok: boolean; latencyMs: number | null; rateLimited: boolean; checkedAt: string } | null }
interface Payload { migrated: boolean; providers: ProviderRow[]; coverage: CoverageRow[]; recentSyncs: SyncRow[]; health: HealthRow[] }

const statusTone = (s: string): "volt" | "gold" | "red" | "neutral" =>
  s === "SUCCESS" ? "volt" : s === "FALLBACK" ? "gold" : s === "FAILED" ? "red" : "neutral";

export default function AdminDataPage() {
  const t = useT();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/data", { cache: "no-store" });
      if (res.status === 403) { setForbidden(true); setLoading(false); return; }
      setData(await res.json());
      setLoading(false);
    })();
  }, []);

  if (forbidden) {
    return (
      <>
        <PageHero eyebrow="Admin" title="Data Sources" />
        <div className="container-cr py-16 text-center">
          <ShieldCheck className="mx-auto mb-3 size-10 text-ink-600" />
          <p className="font-display text-lg font-bold text-chalk">{t("Admins only")}</p>
        </div>
      </>
    );
  }

  const healthByKey = new Map((data?.health ?? []).map((h) => [h.sourceKey, h.last]));

  return (
    <>
      <PageHero
        eyebrow="Admin"
        title="Data Sources"
        description="Provider status, coverage and sync telemetry for the multi-source data pipeline."
      />
      <div className="container-cr space-y-10 py-10">
        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-card bg-ink-850/60" />)}</div>
        ) : !data ? (
          <p className="text-sm text-fog">Failed to load.</p>
        ) : (
          <>
            {!data.migrated && (
              <div className="flex items-start gap-3 rounded-xl border border-gold-500/40 bg-gold-500/10 p-4 text-sm text-gold-200">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">Telemetry tables not created yet.</p>
                  <p className="mt-1 text-gold-200/80">Run <code className="rounded bg-ink-950/60 px-1.5 py-0.5">npm run db:push</code> to create the DataSource / ProviderHealth / ProviderSync tables. Provider config below is live regardless.</p>
                </div>
              </div>
            )}

            {/* Providers */}
            <section>
              <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-tight text-chalk">
                <Database className="size-5 text-blood-400" /> Providers
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.providers.map((p) => {
                  const h = healthByKey.get(p.key);
                  return (
                    <div key={p.key} className="card-surface p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-display font-bold text-chalk">{p.label}</span>
                        {p.configured
                          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-volt"><CheckCircle2 className="size-4" /> Configured</span>
                          : <span className="inline-flex items-center gap-1 text-xs font-semibold text-fog"><XCircle className="size-4" /> No key</span>}
                      </div>
                      <p className="mt-1 font-mono text-[0.7rem] text-fog">{p.key}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.sports.map((s) => <span key={s} className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-mist">{s}</span>)}
                      </div>
                      {h && (
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-fog">
                          <Activity className={`size-3.5 ${h.ok ? "text-volt" : "text-blood-400"}`} />
                          {h.ok ? "OK" : "Error"}{h.latencyMs != null ? ` · ${h.latencyMs}ms` : ""}{h.rateLimited ? " · rate-limited" : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Coverage by sport */}
            <section>
              <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-tight text-chalk">Coverage by Sport</h2>
              <div className="overflow-hidden rounded-xl border border-ink-800">
                <table className="w-full text-sm">
                  <thead className="bg-ink-900 text-left text-xs uppercase text-fog">
                    <tr><th className="px-4 py-2.5">Sport</th><th className="px-4 py-2.5">Source priority (highest first)</th></tr>
                  </thead>
                  <tbody>
                    {data.coverage.map((c) => (
                      <tr key={c.sport} className="border-t border-ink-800">
                        <td className="px-4 py-2.5 font-display font-semibold text-chalk">{c.label}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {c.sources.map((s, i) => (
                              <span key={s} className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-[0.65rem] text-mist">
                                <span className="text-fog">{i + 1}.</span> {s}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Recent syncs */}
            <section>
              <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-tight text-chalk">Recent Syncs</h2>
              {data.recentSyncs.length === 0 ? (
                <p className="card-surface p-6 text-center text-sm text-fog">No syncs recorded yet. Trigger one via <code className="rounded bg-ink-950/60 px-1.5 py-0.5">POST /api/cron/sync?group=mma</code>.</p>
              ) : (
                <div className="space-y-2">
                  {data.recentSyncs.map((s) => (
                    <div key={s.id} className="card-surface flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm">
                      <div className="flex items-center gap-3">
                        <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                        <span className="font-display font-semibold text-chalk">{s.sport ?? "all"} · {s.entity}</span>
                        {s.fellBackTo && <span className="text-xs text-gold-300">→ {s.fellBackTo}</span>}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-fog">
                        <span>{s.imported} imported</span>
                        {s.failures > 0 && <span className="text-blood-400">{s.failures} failed</span>}
                        {s.rateLimitHits > 0 && <span className="text-gold-300">{s.rateLimitHits} rate-limited</span>}
                        {s.durationMs != null && <span>{s.durationMs}ms</span>}
                        <span>{new Date(s.startedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
