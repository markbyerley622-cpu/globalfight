"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { PILLARS } from "./pillars";

/**
 * The five pillars, for DESKTOP.
 *
 * The bottom tab bar is `lg:hidden`, so on a laptop the pillars — Location
 * especially — were only reachable through the burger menu. Same five
 * destinations, same order, same matchers as the mobile bar (both read
 * `PILLARS`), rendered inline in the header where a desktop user looks for
 * navigation.
 */
export function PillarNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav aria-label="Primary" className={cn("flex items-center gap-1", className)}>
      {PILLARS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors",
              active ? "bg-ink-800 text-chalk" : "text-mist hover:bg-ink-850 hover:text-chalk",
            )}
          >
            <Icon className={cn("size-4", active && "text-blood-500")} strokeWidth={2} />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
