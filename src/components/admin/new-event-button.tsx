"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { SPORTS } from "@/lib/sports";

/**
 * Creating an event makes a real DRAFT row immediately and navigates into it.
 *
 * Deliberately not a long "new event" form: the editor autosaves, locks fields
 * and audits from the first keystroke, and none of that can work against an
 * object that does not exist yet. Three fields is the minimum to have a row.
 */
export function NewEventButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sport, setSport] = useState("MMA");
  const [date, setDate] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, sport, date: new Date(date).toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not create."); return; }
      router.push(`/admin/events/${data.id}`);
    } catch {
      setError("Could not create.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-blood-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blood-400"
      >
        <Plus className="size-3.5" /> New event
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 p-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim().length >= 3) void create(); if (e.key === "Escape") setOpen(false); }}
        placeholder="Event title"
        className="w-52 rounded border border-ink-700 bg-ink-950/60 px-2 py-1 text-sm text-chalk outline-none placeholder:text-ink-600 focus:border-blood-500/60"
      />
      <select value={sport} onChange={(e) => setSport(e.target.value)} className="rounded border border-ink-700 bg-ink-950/60 px-2 py-1 text-xs text-chalk outline-none">
        {SPORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-ink-700 bg-ink-950/60 px-2 py-1 text-xs text-chalk outline-none [color-scheme:dark]" />
      <button
        onClick={create}
        disabled={busy || name.trim().length < 3}
        className="inline-flex items-center gap-1 rounded bg-blood-500 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null} Create draft
      </button>
      <button onClick={() => setOpen(false)} className="px-1.5 text-xs text-fog hover:text-chalk">Cancel</button>
      {error && <span className="text-[0.7rem] text-blood-300">{error}</span>}
    </div>
  );
}
