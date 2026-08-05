"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Organisation filter for the ranking screens — "All", then one pill per
 * promotion that actually publishes a list for the selected sport (UFC, ONE,
 * PFL, BKFC, WBA…).
 *
 * The options are PASSED IN, derived from the rows that exist, rather than read
 * from a constant. A hardcoded promotion list would show a UFC pill on a sport
 * with no UFC rankings and hide a promotion the moment one was added — a filter
 * that offers an empty result is worse than no filter.
 *
 * Renders nothing at all when there is at most one organisation: a single-choice
 * filter is decoration, and on the sports whose only rankings are the
 * cross-promotional curated lists there is nothing to choose between.
 *
 * Selection lives in the URL (?org=UFC) so it survives refresh, share and
 * back/forward — the same contract as SportFilter, which it sits beneath.
 */
export function OrganisationFilter({ organisations }: { organisations: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("org") ?? "";

  if (organisations.length < 2) return null;

  function pick(org: string) {
    const p = new URLSearchParams(params.toString());
    if (org) p.set("org", org);
    else p.delete("org");
    p.delete("page"); // a new organisation is a new list — page 3 of it is meaningless
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const pills = [{ value: "", label: "All" }, ...organisations.map((o) => ({ value: o, label: o }))];

  return (
    <div data-hscroll className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {pills.map((p) => {
        const active = current === p.value;
        return (
          <button
            key={p.value || "all"}
            onClick={() => pick(p.value)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 font-display text-2xs font-semibold uppercase tracking-wide transition-colors",
              active
                ? "border-gold-500 bg-gold-500/15 text-gold-300"
                : "border-ink-700 bg-ink-900/60 text-mist hover:border-gold-500/50 hover:text-chalk",
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
