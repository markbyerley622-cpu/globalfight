"use client";

import Link from "next/link";
import { FOOTER_NAV, SITE } from "@/lib/config";
import { Logo } from "@/components/logo";
import { useT } from "@/lib/i18n";

export function Footer({ demoMode = false }: { demoMode?: boolean }) {
  const t = useT();
  return (
    <footer className="mt-20 border-t border-ink-700 bg-ink-950">
      <div className="container-cr py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo sizeClass="h-14" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist">{SITE.description}</p>
            <p className="mt-4 text-xs text-fog">
              Independent platform. Data sourced and cached from public records. Not affiliated with any sanctioning body.
            </p>
          </div>

          {FOOTER_NAV.map((col) => (
            <div key={col.title}>
              <h3 className="font-display text-xs font-bold uppercase tracking-widest text-fog">{t(col.title)}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-sm text-mist transition-colors hover:text-blood-400">
                      {t(item.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {demoMode && (
          <p className="mt-8 text-center text-xs text-volt-400/80">
            Simulated community activity • Reset periodically
          </p>
        )}

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-ink-800 pt-6 text-xs text-fog sm:flex-row">
          <p>© 2026 {SITE.name}. {t("All rights reserved.")}</p>
          <p className="flex items-center gap-2">
            <span className="rounded bg-ink-800 px-2 py-0.5">{t("Open registry")}</span>
            {t("Every profile is source-backed. Submit corrections or claim your profile anytime.")}
          </p>
        </div>
      </div>
    </footer>
  );
}
