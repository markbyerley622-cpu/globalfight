"use client";

import { Lock, Unlock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Dense form primitives for the operations console. Deliberately not the
// consumer input styles: smaller targets, tighter rows, label above value, no
// decoration. This is software someone uses for four hours on a fight week.
//
// The lock affordance is the important one. A field an operator has edited is
// held against the ingest pipeline, and that has to be VISIBLE — otherwise the
// reason a scraper stopped updating a venue is invisible folklore.

export function Row({ label, hint, issue, locked, onToggleLock, children }: {
  label: string;
  hint?: string;
  issue?: string | null;
  locked?: boolean;
  onToggleLock?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-3 border-b border-ink-800/70 px-3 py-2 last:border-0">
      <div className="flex items-center gap-1.5 pt-1.5">
        <label className="text-[0.7rem] font-semibold uppercase tracking-wide text-fog">{label}</label>
        {onToggleLock && (
          <button
            type="button"
            onClick={onToggleLock}
            title={locked
              ? "Held against automated updates. Click to release it back to the scraper."
              : "Automated updates may overwrite this. Editing it holds it."}
            aria-pressed={!!locked}
            className={cn("tap rounded p-0.5 transition-colors", locked ? "text-gold-400 hover:text-gold-300" : "text-ink-600 hover:text-fog")}
          >
            {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
          </button>
        )}
      </div>
      <div className="min-w-0">
        {children}
        {hint && !issue && <p className="mt-1 text-[0.68rem] text-fog">{hint}</p>}
        {issue && (
          <p className="mt-1 flex items-start gap-1 text-[0.68rem] text-blood-300">
            <AlertCircle className="mt-px size-3 shrink-0" /> {issue}
          </p>
        )}
      </div>
    </div>
  );
}

const base =
  "w-full rounded-md border bg-ink-950/60 px-2.5 py-1.5 text-sm text-chalk outline-none transition-colors placeholder:text-ink-600 focus:border-blood-500/60";

export function Text({ value, onChange, onBlur, invalid, placeholder, type = "text", mono }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void;
  invalid?: boolean; placeholder?: string; type?: string; mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={cn(base, invalid ? "border-blood-500/70" : "border-ink-700", mono && "font-mono text-xs")}
    />
  );
}

export function Area({ value, onChange, onBlur, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={cn(base, "resize-y border-ink-700")}
    />
  );
}

export function Select({ value, onChange, options, invalid }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; invalid?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(base, invalid ? "border-blood-500/70" : "border-ink-700")}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * A datetime-local control bound to an ISO instant.
 *
 * datetime-local has no timezone, so the value is converted through the
 * BROWSER's zone on the way in and back out. An operator in London editing a
 * Bangkok card sees London time — which is correct, because the alternative is
 * a field that silently means something different depending on who opened it.
 */
export function DateTime({ value, onChange, invalid }: {
  value: string | null; onChange: (iso: string | null) => void; invalid?: boolean;
}) {
  const local = value ? toLocalInput(value) : "";
  return (
    <input
      type="datetime-local"
      value={local}
      onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      className={cn(base, invalid ? "border-blood-500/70" : "border-ink-700", "[color-scheme:dark]")}
    />
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
        checked ? "border-blood-500/60 bg-blood-500/15 text-chalk" : "border-ink-700 text-fog hover:text-mist",
      )}
    >
      <span className={cn("size-2 rounded-full", checked ? "bg-blood-400" : "bg-ink-600")} />
      {label}
    </button>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900/40">
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-mist">{title}</h2>
        {actions}
      </header>
      <div>{children}</div>
    </section>
  );
}
