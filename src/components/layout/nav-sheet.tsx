"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import { PRIMARY_NAV, SITE, type NavItem } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { Sheet } from "@/components/ui/sheet";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Mobile "More / Account" sheet, opened from the top-bar avatar. Surfaces the
 * full PRIMARY_NAV (Clips, Community, Library, Combat and every Explore child)
 * so the 5-tab bottom bar loses nothing, plus account + language.
 */
export function NavSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const t = useT();
  const { user } = useAuth();

  const link = (item: NavItem, sub = false) => {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          "block rounded-xl px-3 transition-colors",
          sub ? "py-2 text-sm font-medium" : "py-2.5 font-display text-sm font-semibold uppercase tracking-wide",
          item.accent
            ? "border border-blood-500/40 bg-blood-500/10 text-blood-300"
            : active
              ? "bg-ink-800 text-chalk"
              : "text-mist hover:bg-ink-800 hover:text-chalk",
        )}
      >
        {t(item.label)}
      </Link>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("Menu")}>
      {/* Account */}
      <div className="px-5">
        <Link
          href="/account"
          onClick={onClose}
          className="flex items-center gap-3 rounded-2xl border border-ink-700 bg-ink-850 p-3"
        >
          <span className="flex size-11 items-center justify-center rounded-full border-2 border-blood-500 bg-ink-950 font-display text-base font-bold text-blood-500 shadow-[0_0_12px_-3px_rgba(225,29,42,0.55)]">
            {user ? (user.name ?? user.username ?? "?").slice(0, 1).toUpperCase() : <User className="size-5" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display font-bold uppercase tracking-tight text-chalk">
              {user ? (user.username ?? user.name) : t("Guest fan")}
            </span>
            <span className="block truncate text-xs text-mist">
              {user ? user.email : t("Sign in to follow fighters & save predictions")}
            </span>
          </span>
        </Link>
      </div>

      {/* Full nav */}
      <nav className="mt-3 space-y-0.5 px-3">
        {PRIMARY_NAV.map((item) =>
          item.children ? (
            <div key={item.href} className="pt-1">
              <div className={cn("px-3 pb-1 pt-2 font-display text-[0.65rem] font-bold uppercase tracking-widest", item.accent ? "text-blood-400" : "text-fog")}>
                {t(item.label)}
              </div>
              {item.children.map((c) => link(c, true))}
            </div>
          ) : (
            link(item)
          ),
        )}
      </nav>

      <p className="mt-4 px-5 text-center text-[0.65rem] leading-relaxed text-fog">
        {SITE.name} — {SITE.tagline}. Independent platform; data sourced from public records.
      </p>
    </Sheet>
  );
}
