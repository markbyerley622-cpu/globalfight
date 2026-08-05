"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert, EyeOff, Eye, Check, X, ExternalLink, History } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { cn } from "@/lib/utils";
import type { QueueItem, HistoryEntry, ReportStatus } from "@/lib/moderation/reports";

const STATUS_TABS: { value: ReportStatus | "ALL"; label: string }[] = [
  { value: "OPEN", label: "Pending" },
  { value: "REVIEWED", label: "Resolved" },
  { value: "DISMISSED", label: "Dismissed" },
  { value: "ALL", label: "All" },
];

// The reasons the report dialog actually offers. A filter for a reason nobody
// can file is a dead control.
const REASON_TABS: { value: string; label: string }[] = [
  { value: "ALL", label: "Any reason" },
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "hate", label: "Hate speech" },
  { value: "other", label: "Other" },
];

/**
 * The moderator console — queue on the left, decision history beneath.
 *
 * Optimistic only in the sense that a row leaves the list once actioned; the
 * status shown always comes from the server's reply, because "did that hide
 * actually apply?" is the one question a moderator must never have to guess at.
 */
export function ReportsConsole({
  initialReports, initialHistory,
}: {
  initialReports: QueueItem[];
  initialHistory: HistoryEntry[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [history, setHistory] = useState(initialHistory);
  const [status, setStatus] = useState<ReportStatus | "ALL">("OPEN");
  const [reason, setReason] = useState("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: ReportStatus | "ALL", nextReason: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${nextStatus}&reason=${nextReason}&history=1`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReports(data.reports ?? []);
      setHistory(data.history ?? []);
    } catch {
      setError("Couldn't load the queue. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function act(reportId: string, action: "hide" | "restore" | "dismiss" | "resolve") {
    setBusy(reportId);
    setError(null);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "That action didn't apply."); return; }
      await load(status, reason);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHero
        eyebrow="Moderation"
        title="Reports"
        description="Member reports awaiting review. Every decision is recorded against your account."
      />
      <div className="container-cr space-y-5 py-8">
        {/* Filters */}
        <div className="space-y-2">
          <Row label="Status">
            {STATUS_TABS.map((t) => (
              <Pill key={t.value} active={status === t.value} onClick={() => { setStatus(t.value); void load(t.value, reason); }}>
                {t.label}
              </Pill>
            ))}
          </Row>
          <Row label="Reason">
            {REASON_TABS.map((t) => (
              <Pill key={t.value} active={reason === t.value} onClick={() => { setReason(t.value); void load(status, t.value); }}>
                {t.label}
              </Pill>
            ))}
          </Row>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 py-10 text-sm text-fog"><Loader2 className="size-4 animate-spin" /> Loading…</p>
        ) : reports.length === 0 ? (
          <div className="card-surface p-10 text-center">
            <ShieldAlert className="mx-auto size-6 text-fog" />
            <p className="mt-2 font-display text-base font-bold text-chalk">Nothing to review</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-fog">
              No reports match this filter. That is the good outcome.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="card-surface p-4">
                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <span className="rounded-full border border-blood-500/40 bg-blood-500/15 px-2 py-0.5 font-bold uppercase tracking-wide text-blood-200">
                    {r.reason}
                  </span>
                  {/* Corroboration is the strongest triage signal on the page. */}
                  {r.reportCount > 1 && (
                    <span className="rounded-full border border-gold-500/40 bg-gold-500/15 px-2 py-0.5 font-bold uppercase tracking-wide text-gold-300">
                      {r.reportCount} reports
                    </span>
                  )}
                  <span className="rounded-full border border-ink-700 px-2 py-0.5 uppercase tracking-wide text-fog">{r.status}</span>
                  {r.target?.hidden && (
                    <span className="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 uppercase tracking-wide text-mist">Hidden</span>
                  )}
                  <span className="ml-auto text-fog">{new Date(r.createdAt).toLocaleString()}</span>
                </div>

                {/* The reported content, verbatim. A moderator cannot decide on a
                    summary, and making them click through to read it is how
                    queues stop getting worked. */}
                <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/50 p-3">
                  {r.target ? (
                    <>
                      <p className="whitespace-pre-wrap break-words text-sm text-mist">{r.target.excerpt}</p>
                      <p className="mt-2 text-2xs text-fog">
                        {r.targetType} by{" "}
                        {r.target.authorUsername ? (
                          <Link href={`/u/${r.target.authorUsername}`} className="text-mist underline-offset-2 hover:underline">
                            {r.target.authorName}
                          </Link>
                        ) : (
                          <span className="text-mist">{r.target.authorName}</span>
                        )}
                        {r.target.href && (
                          <>
                            {" · "}
                            <Link href={r.target.href} className="inline-flex items-center gap-1 text-blood-300 underline-offset-2 hover:underline">
                              In context <ExternalLink className="size-3" />
                            </Link>
                          </>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm italic text-fog">
                      The reported content no longer exists — it was deleted before review.
                    </p>
                  )}
                </div>

                <p className="mt-2 text-2xs text-fog">
                  Reported by{" "}
                  {r.reporter.username ? (
                    <Link href={`/u/${r.reporter.username}`} className="text-mist underline-offset-2 hover:underline">
                      {r.reporter.name}
                    </Link>
                  ) : r.reporter.name}
                  {r.detail && <> · “{r.detail}”</>}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {r.targetType === "post" && r.target && !r.target.hidden && (
                    <Action onClick={() => act(r.id, "hide")} busy={busy === r.id} tone="danger" icon={<EyeOff className="size-3.5" />}>
                      Hide post
                    </Action>
                  )}
                  {r.targetType === "post" && r.target?.hidden && (
                    <Action onClick={() => act(r.id, "restore")} busy={busy === r.id} icon={<Eye className="size-3.5" />}>
                      Restore post
                    </Action>
                  )}
                  <Action onClick={() => act(r.id, "resolve")} busy={busy === r.id} icon={<Check className="size-3.5" />}>
                    Mark resolved
                  </Action>
                  <Action onClick={() => act(r.id, "dismiss")} busy={busy === r.id} icon={<X className="size-3.5" />}>
                    Dismiss
                  </Action>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Moderation history — moderator-only, and the reason the console can be
            trusted: every decision above becomes a row here, attributable. */}
        <section className="pt-4">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.18em] text-fog">
            <History className="size-4" /> Moderation history
          </h2>
          {history.length === 0 ? (
            <p className="card-surface p-4 text-sm text-fog">No moderation actions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-ink-800 overflow-hidden card-surface">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
                  <span className="font-display font-bold uppercase tracking-wide text-chalk">{h.action}</span>
                  <span className="text-fog">by {h.moderator}</span>
                  {h.targetType && <span className="text-fog">· {h.targetType}</span>}
                  {h.note && <span className="text-mist">· {h.note}</span>}
                  <span className="ml-auto tabular-nums text-fog">{new Date(h.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-3xs font-bold uppercase tracking-wider text-fog">{label}</span>
      <div data-hscroll className="flex gap-1.5 overflow-x-auto pb-1 hide-scrollbar">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        active ? "border-blood-500 bg-blood-500 text-white" : "border-ink-700 bg-ink-900/60 text-mist hover:border-blood-500/50",
      )}
    >
      {children}
    </button>
  );
}

function Action({
  onClick, busy, icon, tone = "neutral", children,
}: {
  onClick: () => void; busy: boolean; icon: React.ReactNode;
  tone?: "neutral" | "danger"; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "tap inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
        tone === "danger"
          ? "border-blood-500/50 text-blood-200 hover:bg-blood-500/15"
          : "border-ink-700 text-mist hover:border-ink-600 hover:bg-ink-800",
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
