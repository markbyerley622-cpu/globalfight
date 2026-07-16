"use client";

import { useT } from "@/lib/i18n";

export function PageHero({
  eyebrow, title, description, children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="relative overflow-hidden border-b border-ink-800">
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div className="absolute -left-32 top-0 size-96 rounded-full bg-blood-700/15 blur-[110px]" />
      <div className="absolute inset-0 vignette" />
      <div className="container-cr relative py-12 lg:py-16">
        <span className="eyebrow">{t(eyebrow)}</span>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase tracking-tight text-chalk sm:text-5xl lg:text-6xl">
          {t(title)}
        </h1>
        {description && <p className="mt-3 max-w-2xl text-sm text-mist sm:text-base">{t(description)}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  );
}
