"use client";

import { useEffect, useState } from "react";
import { Loader2, Undo2, X } from "lucide-react";
import { timeAgo } from "@/lib/utils";

interface Change { field: string; from: unknown; to: unknown }
interface Entry { id: string; action: string; actor: string; at: string; meta: unknown }

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString();
  return String(v);
};

/** Who changed what, when, from what, to what. Read-only and complete — the
 *  audit row is written in the same transaction as the change, so there is no
 *  edit that can be missing from this list. */
export function AuditDrawer({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/events/${eventId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEntries(d.history ?? []))
      .catch(() => setEntries([]));
  }, [eventId]);

  /**
   * Undo is applied as a NORMAL edit — same validation, same locking, its own
   * audit entry. A raw revert could restore a state the card can no longer be
   * in (a slug now taken by another event), and would be the one change with no
   * trail of its own.
   */
  async function undo(id: string) {
    setUndoing(id); setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/locks`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ undo: id }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.issues?.[0]?.message ?? "Could not undo that change."); return; }
      window.location.reload();
    } catch { setError("Could not undo that change."); }
    finally { setUndoing(null); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-ink-800 bg-ink-950"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">History</h2>
          <button onClick={onClose} className="rounded p-1 text-fog hover:text-chalk" aria-label="Close"><X className="size-4" /></button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {error && <p className="border-b border-ink-800 bg-blood-500/10 px-4 py-2 text-xs text-blood-300">{error}</p>}
          {entries === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-fog">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fog">No changes recorded yet.</p>
          ) : (
            <ol className="divide-y divide-ink-800/70">
              {entries.map((e) => {
                const changes = (e.meta as { changes?: Change[] } | null)?.changes ?? [];
                return (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[0.7rem] text-blood-300">{e.action}</span>
                      <span className="text-[0.68rem] text-fog">{timeAgo(e.at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className="text-xs text-mist">{e.actor}</p>
                      {e.action === "event.update" && changes.length > 0 && (
                        <button
                          onClick={() => undo(e.id)}
                          disabled={undoing === e.id}
                          className="inline-flex items-center gap-1 rounded border border-ink-700 px-1.5 py-0.5 text-[0.65rem] font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300 disabled:opacity-40"
                        >
                          {undoing === e.id ? <Loader2 className="size-2.5 animate-spin" /> : <Undo2 className="size-2.5" />} Undo
                        </button>
                      )}
                    </div>
                    {changes.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {changes.map((c, i) => (
                          <li key={`${c.field}-${i}`} className="rounded bg-ink-900/60 px-2 py-1 text-[0.7rem]">
                            <span className="font-mono text-fog">{c.field}</span>
                            <span className="mx-1.5 text-ink-600">·</span>
                            <span className="text-fog line-through">{show(c.from)}</span>
                            <span className="mx-1 text-ink-600">→</span>
                            <span className="text-chalk">{show(c.to)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
