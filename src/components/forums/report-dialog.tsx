"use client";

import { useState } from "react";
import { Flag, Loader2, X, Check } from "lucide-react";

const REASONS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "off_topic", label: "Off-topic" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Something else" },
];

/**
 * Report a thread or post for moderation (Phase 6). Persists a ForumReport row;
 * one open report per user per target.
 */
export function ReportButton({
  targetType, targetId, compact,
}: {
  targetType: "thread" | "post"; targetId: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/forums/report", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, detail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not file report.");
      setDone(true);
      setTimeout(() => { setOpen(false); setDone(false); setDetail(""); }, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not file report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Report"
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300"
      >
        <Flag className="size-3.5" /> {!compact && "Report"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/80 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-card border border-ink-700 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Report {targetType}</h3>
              <button onClick={() => !busy && setOpen(false)} className="text-fog hover:text-chalk"><X className="size-4" /></button>
            </div>
            {done ? (
              <p className="flex items-center gap-2 py-4 text-sm text-up"><Check className="size-4" /> Thanks — our moderators will review this.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {REASONS.map((r) => (
                    <label key={r.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-mist hover:bg-ink-850">
                      <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-blood-500" />
                      {r.label}
                    </label>
                  ))}
                </div>
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  rows={2}
                  placeholder="Add detail (optional)"
                  className="mt-3 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-2.5 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
                />
                {error && <p className="mt-2 text-xs text-blood-300">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold text-mist hover:text-chalk">Cancel</button>
                  <button onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-3 py-2 text-xs font-semibold uppercase text-white hover:bg-blood-400 disabled:opacity-50">
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Flag className="size-3.5" />} Submit
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
