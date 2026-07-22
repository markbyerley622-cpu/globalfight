"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { PILLARS } from "./pillars";

/**
 * The five product pillars: Events · Leaderboard · Following · Location · Profile.
 *
 * One tab per pillar, in the same order everywhere, never conditional. Home is
 * reachable from the logo in the top bar and Community from the nav sheet —
 * neither is a pillar, and a bottom bar that changes shape between pages is the
 * fastest way to make an app feel unfinished.
 */

export function BottomTabBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex shrink-0 items-end justify-around border-t border-ink-800 bg-ink-950/80 px-2 pt-2 backdrop-blur-xl",
        "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {PILLARS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-1 transition-colors",
              active ? "text-chalk" : "text-fog hover:text-mist",
            )}
          >
            <Icon className={cn("size-6", active && "text-blood-500")} strokeWidth={2} />
            <span
              className={cn(
                "text-[0.58rem] font-bold uppercase leading-none tracking-wide",
                active && "text-blood-400",
              )}
            >
              {t(label)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
