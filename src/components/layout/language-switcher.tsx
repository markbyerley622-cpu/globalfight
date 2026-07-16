"use client";

import { useState, useRef, useEffect } from "react";
import { Globe, Check } from "lucide-react";
import { LOCALES, type Locale } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale: active, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const choose = (code: Locale) => {
    setLocale(code);
    setOpen(false);
  };

  const current = LOCALES.find((l) => l.code === active) ?? LOCALES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk"
        aria-label="Change language"
      >
        <Globe className="size-4" />
        <span className="hidden font-semibold uppercase sm:inline">{current.code}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => choose(l.code)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-ink-700",
                active === l.code ? "text-chalk" : "text-mist",
              )}
            >
              <span><span className="font-medium">{l.native}</span> <span className="text-xs text-fog">{l.name}</span></span>
              {active === l.code && <Check className="size-4 text-blood-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
