"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export type SectionItem = { label: string; href: string; match: (p: string) => boolean };

/**
 * Martial-arts pills that filter the unified home flow via ?sport=. These
 * replace the old section pills (News/Community/Registry/Rankings/…): one flow,
 * filtered by discipline, not a set of separate section pages.
 */
export const SPORT_PILLS: { label: string; slug: string }[] = [
  { label: "All", slug: "" },
  { label: "MMA", slug: "mma" },
  { label: "Boxing", slug: "boxing" },
  { label: "Muay Thai", slug: "muay-thai" },
  { label: "Kickboxing", slug: "kickboxing" },
  { label: "BJJ", slug: "bjj" },
  { label: "Bare Knuckle", slug: "bare-knuckle" },
  { label: "Wrestling", slug: "wrestling" },
  { label: "Judo", slug: "judo" },
  { label: "Taekwondo", slug: "taekwondo" },
  { label: "Sambo", slug: "sambo" },
];

// Home ("/") is the surface that carries the sport pills. Kept as a one-entry
// "section" so AppShell's swipe/section machinery keeps compiling unchanged.
export const FEED_SECTION: SectionItem[] = [
  { label: "Home", href: "/", match: (p) => p === "/" },
];

// ── Location ──────────────────────────────────────────────────────────────
// Its own swipe section, so a phone can move between the map and the places
// it points at without going back to a menu. It is deliberately NOT folded
// into the feed section: swiping off a map onto the news feed would be a
// surprise, and the map owns horizontal drag inside its own frame.
//
// `data-hscroll` on the map surface stops a pan gesture from being read as a
// section swipe — see AppShell's startsInHScroller().
export const LOCATION_SECTION: SectionItem[] = [
  { label: "Map", href: "/map", match: (p) => p === "/map" },
  { label: "Gyms", href: "/gyms", match: (p) => p.startsWith("/gyms") },
  { label: "Events", href: "/events", match: (p) => p.startsWith("/events") },
];

const SECTIONS = [FEED_SECTION, LOCATION_SECTION];

export function activeSection(pathname: string): SectionItem[] | null {
  return SECTIONS.find((s) => s.some((i) => i.match(pathname))) ?? null;
}
export function sectionIndex(section: SectionItem[], pathname: string) {
  return section.findIndex((i) => i.match(pathname));
}

function SportPills() {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();
  if (pathname !== "/") return null; // pills belong to the unified home flow only
  const current = params.get("sport") ?? "";
  return (
    <div data-hscroll className="hide-scrollbar flex items-center gap-2 overflow-x-auto px-4 py-2">
      {SPORT_PILLS.map((s) => {
        const active = current === s.slug;
        const href = s.slug ? `/?sport=${s.slug}` : "/";
        return (
          <Link
            key={s.slug || "all"}
            href={href}
            scroll={false}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-[0.8rem] font-semibold transition-colors",
              active
                ? "border-chalk bg-chalk text-ink-950"
                : "border-ink-700 bg-ink-800 text-mist hover:border-ink-600 hover:text-chalk",
            )}
          >
            {t(s.label)}
          </Link>
        );
      })}
    </div>
  );
}

/** Tabs for the current section: sport pills on Home, siblings elsewhere. */
function SectionLinks() {
  const pathname = usePathname();
  const t = useT();
  const section = activeSection(pathname);
  if (!section || section === FEED_SECTION) return null;

  return (
    <div data-hscroll className="hide-scrollbar flex items-center gap-2 overflow-x-auto px-4 py-2">
      {section.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-[0.8rem] font-semibold transition-colors",
              active
                ? "border-chalk bg-chalk text-ink-950"
                : "border-ink-700 bg-ink-800 text-mist hover:border-ink-600 hover:text-chalk",
            )}
          >
            {t(item.label)}
          </Link>
        );
      })}
    </div>
  );
}

/** Section tabs — sport pills on the home flow, siblings inside a section. */
export function SectionTabs() {
  return (
    <Suspense fallback={null}>
      <SportPills />
      <SectionLinks />
    </Suspense>
  );
}
