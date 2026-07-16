"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, type NavItem } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The site menu — moved out of the top-bar hamburger and into the Profile tab.
 * Surfaces the full PRIMARY_NAV (Feed, News, Community, Explore children,
 * Library) so every destination stays reachable, plus language.
 */
export function ProfileMenu() {
  const pathname = usePathname();
  const t = useT();

  const link = (item: NavItem, sub = false) => {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "block rounded-xl px-3 transition-colors",
          sub ? "py-2 text-sm font-medium" : "py-2.5 font-display text-sm font-semibold uppercase tracking-wide",
          active ? "bg-ink-800 text-chalk" : "text-mist hover:bg-ink-800 hover:text-chalk",
        )}
      >
        {t(item.label)}
      </Link>
    );
  };

  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-2">
      {PRIMARY_NAV.map((item) =>
        item.children ? (
          <div key={item.href} className="pt-1">
            <div className="px-3 pb-1 pt-2 font-display text-[0.62rem] font-bold uppercase tracking-widest text-fog">{t(item.label)}</div>
            {item.children.map((c) => link(c, true))}
          </div>
        ) : (
          link(item)
        ),
      )}
      <div className="mt-2 px-2 pb-1"><LanguageSwitcher /></div>
    </div>
  );
}
