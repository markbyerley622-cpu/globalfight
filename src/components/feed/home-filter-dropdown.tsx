"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Home feed filters collapsed into a hamburger dropdown (replaces the old
 * horizontal pill row). Drives the same feed query state as before — this is
 * pure UI over the existing `value`/`onChange`. Keyboard + outside-click close.
 */
export function HomeFilterDropdown({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[0.8rem] font-semibold transition-colors",
          open ? "border-blood-500/60 bg-ink-800 text-chalk" : "border-ink-700 bg-ink-800 text-mist hover:border-ink-600 hover:text-chalk",
        )}
      >
        <SlidersHorizontal className="size-3.5" />
        <span>{active.label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-52 overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 p-1.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        >
          <div className="px-2 pb-1 pt-1.5 font-display text-[0.62rem] font-bold uppercase tracking-widest text-fog">Filter feed</div>
          {options.map((o) => {
            const sel = o.id === value;
            return (
              <button
                key={o.id}
                role="menuitemradio"
                aria-checked={sel}
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition-colors",
                  sel ? "bg-ink-800 text-chalk" : "text-mist hover:bg-ink-800 hover:text-chalk",
                )}
              >
                {o.label}
                {sel && <Check className="size-4 text-blood-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
