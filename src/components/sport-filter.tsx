"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SPORTS } from "@/lib/sports";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The 11 sports surfaced in the discovery filter (matches the product spec).
const FILTER_SPORTS = SPORTS.filter((s) => !["BJJ_NOGI", "COMBAT_SAMBO"].includes(s.value));

/**
 * Global sport filter used across rankings / p4p / predictions / fighters /
 * schedule / results. Selection persists in the URL (?sport=mma) so it
 * survives refresh, share and back/forward. Server pages read searchParams.sport.
 */
export function SportFilter({ availableSlugs }: { availableSlugs?: string[] } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();
  const current = params.get("sport") ?? "";

  // When the caller says which sports it can actually serve, the rest are shown
  // as "Soon" and are not clickable.
  //
  // The alternative — letting every sport through to a real page that renders an
  // empty table — is the thing this exists to stop. A reader who taps Judo and
  // gets a blank ranking learns "this product is broken", not "this sport has no
  // published ranking"; and there is no way for them to tell those apart. Naming
  // it up front is both more honest and less work for them.
  //
  // Undefined means "no opinion" — every other screen keeps the plain filter.
  const available = availableSlugs ? new Set(availableSlugs) : null;

  function pick(slug: string) {
    const p = new URLSearchParams(params.toString());
    if (slug) p.set("sport", slug);
    else p.delete("sport");
    p.delete("page"); // reset pagination on sport change
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const pills = [{ slug: "", label: t("All Sports") }, ...FILTER_SPORTS.map((s) => ({ slug: s.slug, label: s.label }))];

  return (
    <div data-hscroll className="-mx-4 mb-1 flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {pills.map((p) => {
        const active = current === p.slug;
        // "" is the All pill — never gated.
        const soon = available !== null && p.slug !== "" && !available.has(p.slug);
        return (
          <button
            key={p.slug || "all"}
            onClick={() => { if (!soon) pick(p.slug); }}
            disabled={soon}
            aria-disabled={soon}
            title={soon ? `${p.label} rankings are not published yet` : undefined}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
              soon
                ? "cursor-not-allowed border-ink-800 bg-ink-900/30 text-fog/60"
                : active
                  ? "border-blood-500 bg-blood-500 text-white"
                  : "border-ink-700 bg-ink-900/60 text-mist hover:border-blood-500/50 hover:text-chalk",
            )}
          >
            {p.label}
            {soon && <span className="ml-1.5 text-[0.6rem] font-normal tracking-normal opacity-70">{t("Soon")}</span>}
          </button>
        );
      })}
    </div>
  );
}
