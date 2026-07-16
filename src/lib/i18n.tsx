"use client";

// ════════════════════════════════════════════════════════════════════════
//  Client-side i18n context. Shares the dictionary with the server translator
//  via `@/lib/i18n-dict`. Changing language sets the `locale` cookie AND calls
//  router.refresh() so SERVER-rendered cards re-render in the new language too
//  (not just client UI).
// ════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/config";
import { translate } from "@/lib/i18n-dict";

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const readCookie = (): Locale => {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const m = document.cookie.match(/(?:^|; )locale=([^;]+)/);
  const code = m?.[1];
  return LOCALES.some((l) => l.code === code) ? (code as Locale) : DEFAULT_LOCALE;
};

const applyDir = (locale: Locale) => {
  if (typeof document === "undefined") return;
  const loc = LOCALES.find((l) => l.code === locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = loc?.rtl ? "rtl" : "ltr";
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const fromCookie = readCookie();
    setLocaleState(fromCookie);
    applyDir(fromCookie);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    document.cookie = `locale=${l}; path=/; max-age=31536000`;
    applyDir(l);
    setLocaleState(l);
    router.refresh(); // re-render server components (cards) with the new locale
  }, [router]);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}

/** Convenience hook returning just the translate function. */
export function useT(): (key: string) => string {
  return useI18n().t;
}
