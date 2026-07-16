"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption { value: string; label: string }

/**
 * Custom, accessible select — replaces the ugly native <select>. Styled to
 * match the app, touch-friendly on mobile (full-width menu, large tap targets),
 * optional type-ahead search for long lists (e.g. countries).
 */
export function FilterSelect({
  value, onChange, options, placeholder, searchable = false, className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const shown = searchable && q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-ink-950/50 px-3 text-left text-sm transition-colors",
          open ? "border-blood-500/50" : "border-ink-700 hover:border-ink-600",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn("truncate", selected ? "text-chalk" : "text-fog")}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-fog transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-ink-800 px-3">
              <Search className="size-4 text-fog" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="h-10 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            <li>
              <button type="button" onClick={() => pick("")} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-mist hover:bg-ink-800">
                {placeholder}
                {!value && <Check className="size-4 text-blood-400" />}
              </button>
            </li>
            {shown.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => pick(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-ink-800",
                    value === o.value ? "text-chalk" : "text-mist",
                  )}
                >
                  {o.label}
                  {value === o.value && <Check className="size-4 text-blood-400" />}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-center text-xs text-fog">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
