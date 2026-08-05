"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X, SlidersHorizontal, ChevronDown } from "lucide-react";
import { SPORTS } from "@/lib/sports";
import type { EventFacet } from "@/lib/events-query";
import { cn } from "@/lib/utils";
import { preserveScrollOnNextNavigation } from "@/components/layout/scroll-restoration";

// Every filter lives in the URL and nothing is filtered on the client — this
// component only WRITES query params; the server does the work and re-renders.
// That makes each combination shareable, bookmarkable and indexable.

const FILTER_SPORTS = SPORTS.filter((s) => !["BJJ_NOGI", "COMBAT_SAMBO"].includes(s.value));

const STATUSES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Results" },
  { value: "cancelled", label: "Off" },
];

const WINDOWS = [
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
  { value: "quarter", label: "90 days" },
];

export function EventFilters({ facets }: { facets: { promotions: EventFacet[]; countries: EventFacet[] } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * COLLAPSE ONCE PINNED.
   *
   * All four rows pinned to the top is roughly 150px of chrome — on a 780px
   * phone that is a fifth of the screen permanently occupied by controls,
   * following the reader down a list they are trying to look at.
   *
   * So the bar has two shapes. At the top of the page it is fully open, because
   * that is when someone is deciding what to look at. Once it sticks it drops to
   * the Sport row plus a toggle: sport is the filter people actually change
   * mid-scroll, and the rest are set once and left. Tapping the toggle brings
   * them back at any time, and the active-count on it means a collapsed bar
   * never hides the fact that filters are on.
   */
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    // A zero-height marker directly ABOVE the sticky bar: while it is on screen
    // the bar is in its resting place; the moment it scrolls out, the bar is
    // pinned. Cheaper and steadier than reading scrollTop on every frame, and it
    // observes inside #main because the document itself never scrolls here.
    const io = new IntersectionObserver(
      ([e]) => setStuck(!e.isIntersecting),
      { root: document.getElementById("main"), threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const get = (k: string) => params.get(k) ?? "";

  /** The selected values for a multi-value key. Comma-encoded, matching parseMulti. */
  const many = (k: string): string[] =>
    get(k).split(",").map((v) => v.trim()).filter(Boolean);

  const has = (k: string, v: string) => many(k).includes(v);

  /**
   * Keys the user can combine. `status` and `when` stay single-valued on
   * purpose — "upcoming AND completed" is every event, i.e. no filter at all,
   * and two date windows at once has no meaningful answer either.
   */
  const MULTI = ["sport", "promotion", "country"] as const;

  // Every individual selection, so the count reflects "3 filters" rather than
  // "3 filter groups" — picking MMA + Boxing is two choices and should say so.
  const activeCount =
    MULTI.reduce((n, k) => n + many(k).length, 0) +
    (get("when") ? 1 : 0) +
    (get("status") && get("status") !== "upcoming" ? 1 : 0);



  function write(p: URLSearchParams) {
    p.delete("page"); // any filter change invalidates the current page
    const qs = p.toString();
    // BOTH of these are required, and the second is the one that actually works.
    //
    // `scroll: false` only tells Next not to call window.scrollTo — and the
    // document never scrolls in this app (AppShell is a 100dvh frame; `#main` is
    // the real scroller). So on its own it did nothing, and every pill tap threw
    // the reader back to the top: ScrollRestoration keys on pathname+search,
    // saw a brand-new key on a non-Back navigation, treated it as a new
    // destination and set `#main`.scrollTop = 0.
    //
    // Selecting filters is not arriving somewhere new — it is narrowing the list
    // you are already reading, and with six pills active that reset happened on
    // every single adjustment.
    preserveScrollOnNextNavigation(pathname);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  /** Single-valued keys (status, when) — set or clear. */
  function set(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    write(p);
  }

  /**
   * Multi-valued keys — toggle ONE value, leaving the rest of that group and
   * every other group untouched. This was `p.set(key, value)`, which made the
   * pills behave like radio buttons: choosing Boxing silently dropped MMA.
   */
  function toggle(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    const next = has(key, value)
      ? many(key).filter((v) => v !== value)
      : [...many(key), value];
    if (next.length) p.set(key, next.join(","));
    else p.delete(key);
    write(p);
  }

  function clearAll() {
    // Clearing is a filter change like any other — stay put.
    preserveScrollOnNextNavigation(pathname);
    router.push(pathname, { scroll: false });
  }

  return (
    /*
     * PINNED. The filters govern every list on the page, so they may not scroll
     * away from the lists they govern — narrowing to Boxing used to mean
     * scrolling back to the top to find the pills again, and on a phone that is
     * most of the page.
     *
     * `top-0` is relative to #main, the app shell's single scroll region (the
     * document itself never scrolls here — see app-shell). The negative inline
     * margins let the blurred backing plate span the container's own 1rem
     * padding, so rows slide UNDER an opaque bar instead of past a floating
     * island with content visible either side of it.
     *
     * Order is the reader's: what sport → whose card → where → when. "When"
     * comes last because it is the only group that is meaningfully optional —
     * the other three are how a fan describes the card they are looking for.
     */
    <>
    {/* The stuck-detector. Zero height, no paint. */}
    <div ref={sentinel} aria-hidden className="h-px" />
    <div className="sticky top-0 z-20 -mx-4 space-y-3 border-b border-ink-800 bg-ink-950/95 px-4 py-2.5 backdrop-blur-xl">
      <Row label="Sport">
        <Pill onClick={() => set("sport", "")} active={many("sport").length === 0}>All</Pill>
        {FILTER_SPORTS.map((s) => (
          <Pill key={s.slug} onClick={() => toggle("sport", s.slug)} active={has("sport", s.slug)}>{s.label}</Pill>
        ))}
      </Row>

      {/* Everything below the sport row collapses once the bar is pinned.
          `showSecondary` is true whenever the bar is resting, so the page still
          opens with every filter visible. */}
      {(!stuck || open) && (
      <>
      {facets.promotions.length > 0 && (
        <Row label="Promotion">
          <Pill onClick={() => set("promotion", "")} active={many("promotion").length === 0}>All</Pill>
          {facets.promotions.map((p) => (
            <Pill key={p.value} onClick={() => toggle("promotion", p.value)} active={has("promotion", p.value)}>
              {p.label} <Count n={p.count} />
            </Pill>
          ))}
        </Row>
      )}

      {facets.countries.length > 0 && (
        <Row label="Location">
          <Pill onClick={() => set("country", "")} active={many("country").length === 0}>Anywhere</Pill>
          {facets.countries.map((c) => (
            <Pill key={c.value} onClick={() => toggle("country", c.value)} active={has("country", c.value)}>
              {c.label} <Count n={c.count} />
            </Pill>
          ))}
        </Row>
      )}

      <Row label="When">
        {STATUSES.map((s) => (
          <Pill
            key={s.value}
            onClick={() => set("status", s.value === "upcoming" ? "" : s.value)}
            active={(get("status") || "upcoming") === s.value}
          >
            {s.label}
          </Pill>
        ))}
        <span className="mx-1 w-px shrink-0 self-stretch bg-ink-700" aria-hidden />
        {WINDOWS.map((w) => (
          <Pill key={w.value} onClick={() => set("when", get("when") === w.value ? "" : w.value)} active={get("when") === w.value}>
            {w.label}
          </Pill>
        ))}
      </Row>

      {/* The count is the whole point once filters combine: with four groups on
          screen it is easy to forget that MMA is still on three rows up. It
          counts individual SELECTIONS, not groups — MMA + Boxing reads as 2. */}
      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-full border border-ink-700 px-3 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300"
        >
          <X className="size-3.5" /> Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
        </button>
      )}
      </>
      )}

      {/* The toggle, only while pinned. It carries the active count so a
          collapsed bar can never hide that filters are on — the one thing a
          reader must not lose when the controls fold away. */}
      {stuck && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="tap flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-1 text-2xs font-bold uppercase tracking-wider text-fog transition-colors hover:border-ink-700 hover:text-mist"
        >
          <SlidersHorizontal className="size-3" aria-hidden />
          {open ? "Fewer filters" : "More filters"}
          {activeCount > 0 && (
            <span className="rounded-full bg-blood-500 px-1.5 text-3xs font-black text-white tabular-nums">{activeCount}</span>
          )}
          <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}
    </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[4.5rem] shrink-0 text-3xs font-bold uppercase tracking-wider text-fog">{label}</span>
      <div data-hscroll className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

function Pill({ onClick, active, children }: { onClick: () => void; active: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        active
          ? "border-blood-500 bg-blood-500 text-white"
          : "border-ink-700 bg-ink-900/60 text-mist hover:border-blood-500/50 hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

const Count = ({ n }: { n: number }) => <span className="ml-0.5 tabular-nums opacity-60">{n}</span>;
