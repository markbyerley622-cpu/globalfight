"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X, SlidersHorizontal, ChevronDown } from "lucide-react";
import { SPORTS } from "@/lib/sports";
import type { EventFacet } from "@/lib/events-query";
import { cn } from "@/lib/utils";
import { preserveScrollOnNextNavigation } from "@/components/layout/scroll-restoration";
import { useHideOnScroll } from "@/lib/use-hide-on-scroll";

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

/**
 * Keys the user can combine. `status` and `when` stay single-valued on purpose —
 * "upcoming AND completed" is every event, i.e. no filter at all, and two date
 * windows at once has no meaningful answer either.
 */
const MULTI = ["sport", "promotion", "country"] as const;

/**
 * How long a burst of taps is allowed to coalesce into ONE navigation.
 *
 * Below the ~250ms at which a person perceives cause and effect, so the list
 * still feels like it responds to the tap — but long enough that selecting four
 * pills in a row is one server round-trip instead of four. The PILLS do not wait
 * for it (they read the local draft), so nothing about the control feels delayed.
 */
const COALESCE_MS = 200;

export function EventFilters({ facets }: { facets: { promotions: EventFacet[]; countries: EventFacet[] } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * ONE SHAPE, ALWAYS. The bar's layout box never changes.
   *
   * ── The bug this replaces, and its actual cause ──────────────────────────
   * The bar used to have TWO shapes and three scroll-driven state changes, all
   * of them mutating the height of the same in-flow element. `position: sticky`
   * keeps an element IN FLOW, so every one of those height changes reflowed the
   * entire list below it — while the reader was scrolling through that list.
   * That is the compressing and jumping, and it is a layout problem, not a
   * CSS-value problem: no amount of tuning durations or easings fixes a box that
   * changes size under a moving reader.
   *
   * ── The fix ──────────────────────────────────────────────────────────────
   * The sticky bar is exactly one row plus a toggle, at a CONSTANT height. The
   * extended filters live OUT OF FLOW in an absolutely-positioned panel that
   * overlays the list, so opening and closing them cannot reflow anything.
   *
   * ── Hiding it on scroll, without reintroducing any of that ───────────────
   * The bar now also gets out of the way when the reader scrolls down, which is
   * what every native app does and what was asked for. It does it by
   * TRANSLATING — `transform` is composited and contributes nothing to layout,
   * so the list underneath does not move by a single pixel. That is the
   * distinction that makes this safe where the previous attempt was not: the
   * old one collapsed rows (height), this one slides the whole constant-height
   * box out of the viewport. See lib/use-hide-on-scroll.
   */
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /**
   * Keyboard focus pins the bar open.
   *
   * A bar that is translated off-screen cannot be revealed by scrolling — the
   * offset is a transform, not a scroll position — so a keyboard user who tabs
   * into it would be operating a control they cannot see. Focus therefore
   * suspends the hide entirely until focus leaves.
   */
  const [focused, setFocused] = useState(false);

  // While the extended panel is open the bar must stay put — sliding away the
  // thing an open panel is anchored to is how you get a floating orphan.
  const hidden = useHideOnScroll({ disabled: open || focused });

  // ══════════════════════════════════════════════════════════════════════════
  //  FILTER STATE — the local draft is the source of truth for WRITES.
  //
  //  ── The bug this fixes ──────────────────────────────────────────────────
  //  Every handler used to build its next URL from `useSearchParams()`, which
  //  returns the COMMITTED url. A navigation to /events?sport=mma does not
  //  commit until the server has re-rendered and streamed the payload back —
  //  tens to hundreds of milliseconds. Tap a second pill inside that window and
  //  the handler read the OLD params, so it computed its change against a URL
  //  that no longer reflected the first tap and pushed a URL missing it.
  //
  //  That is exactly the reported symptom: with several filters on, selections
  //  drop, the bar disagrees with the list, and a refresh "resets" to whichever
  //  truncated URL won the race. It got worse the more filters were active,
  //  because more active filters means more taps means more overlap.
  //
  //  Holding the intended value locally removes the race entirely: reads and
  //  writes both go through `draft`, which updates synchronously on tap, and the
  //  URL is a projection of it rather than the other way round.
  // ══════════════════════════════════════════════════════════════════════════
  const [draft, setDraft] = useState(() => params.toString());
  const [isPending, startTransition] = useTransition();

  /** True while a local edit has not yet appeared in the URL. */
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Adopt URL changes that did NOT come from us — Back/Forward, a shared link,
   * the "Show upcoming only" link in the fallback banner.
   *
   * Guarded by `dirty`, so a slow server response can never roll back a tap the
   * reader has already seen take effect.
   */
  useEffect(() => {
    const url = params.toString();
    if (url === draft) {
      dirty.current = false; // our own navigation landed
      return;
    }
    if (!dirty.current) setDraft(url);
  }, [params, draft]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Parsed once per draft change rather than on every pill's every render. */
  const selected = useMemo(() => {
    const p = new URLSearchParams(draft);
    const many = (k: string) =>
      new Set((p.get(k) ?? "").split(",").map((v) => v.trim()).filter(Boolean));
    return {
      sport: many("sport"),
      promotion: many("promotion"),
      country: many("country"),
      status: p.get("status") ?? "",
      when: p.get("when") ?? "",
    };
  }, [draft]);

  // Every individual selection, so the count reflects "3 filters" rather than
  // "3 filter groups" — picking MMA + Boxing is two choices and should say so.
  const activeCount = useMemo(
    () =>
      MULTI.reduce((n, k) => n + selected[k].size, 0) +
      (selected.when ? 1 : 0) +
      (selected.status && selected.status !== "upcoming" ? 1 : 0),
    [selected],
  );

  /**
   * Commit the draft to the URL.
   *
   * `preserveScrollOnNextNavigation` + `scroll: false` are BOTH required, and
   * the first is the one that actually works. `scroll: false` only tells Next
   * not to call window.scrollTo — and the document never scrolls in this app
   * (AppShell is a 100dvh frame; `#main` is the real scroller). So on its own it
   * did nothing, and every pill tap threw the reader back to the top:
   * ScrollRestoration keys on pathname+search, saw a brand-new key on a
   * non-Back navigation, treated it as a new destination and reset `#main`.
   *
   * Selecting filters is not arriving somewhere new — it is narrowing the list
   * you are already reading.
   */
  const commit = useCallback((next: string) => {
    dirty.current = true;
    setDraft(next);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      preserveScrollOnNextNavigation(pathname);
      // Inside a transition, so React keeps the CURRENT list interactive and
      // painted while the next one streams in, instead of tearing it down for a
      // loading state on every tap.
      startTransition(() => {
        router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
      });
    }, COALESCE_MS);
  }, [pathname, router]);

  /** Mutate the draft params. `page` always resets — any filter change invalidates it. */
  const edit = useCallback((fn: (p: URLSearchParams) => void) => {
    // Reads `draft`, the local source of truth, NOT `params` — that distinction
    // is the whole point of this state (see the block comment above).
    const p = new URLSearchParams(draft);
    fn(p);
    p.delete("page");
    commit(p.toString());
  }, [commit, draft]);

  /** Single-valued keys (status, when) — set or clear. */
  const set = useCallback((key: string, value: string) => {
    edit((p) => { if (value) p.set(key, value); else p.delete(key); });
  }, [edit]);

  /**
   * Multi-valued keys — toggle ONE value, leaving the rest of that group and
   * every other group untouched.
   */
  const toggle = useCallback((key: (typeof MULTI)[number], value: string) => {
    edit((p) => {
      const current = (p.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (next.length) p.set(key, next.join(","));
      else p.delete(key);
    });
  }, [edit]);

  const clearAll = useCallback(() => commit(""), [commit]);

  // ── Close the overlay on Escape or an outside tap ───────────────────────
  // An out-of-flow panel that can only be dismissed by finding its own button
  // again is a trap on a phone.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  return (
    /*
     * PINNED. The filters govern every list on the page, so they may not scroll
     * away from the lists they govern — narrowing to Boxing used to mean
     * scrolling back to the top to find the pills again, and on a phone that is
     * most of the page. They now slide away on the way DOWN and return the
     * instant the reader scrolls up, which gives back the full screen for
     * reading without ever putting the controls more than a flick away.
     *
     * `top-0` is relative to #main, the app shell's single scroll region. The
     * negative inline margins let the blurred backing plate span the container's
     * own 1rem padding, so rows slide UNDER an opaque bar instead of past a
     * floating island with content visible either side of it.
     */
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 border-b border-ink-800 bg-ink-950/95 px-4 py-2.5 backdrop-blur-xl",
        // TRANSFORM ONLY. Never height — see lib/use-hide-on-scroll.
        "transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none",
        hidden ? "-translate-y-full" : "translate-y-0",
      )}
      onFocus={() => setFocused(true)}
      // `relatedTarget` still inside the bar means focus is moving BETWEEN its
      // own controls (pill to pill), which must not unpin it.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {/* ── "Your filter is being applied" ──────────────────────────────────
          Taps update the pills INSTANTLY (they read the local draft), so
          without this the reader gets no signal at all that the list they are
          looking at is still the old one. A 2px line inside the bar's own
          padding: it says something is in flight without dimming, spinning or
          blanking the results — the previous list stays readable, which is the
          whole reason the navigation runs in a transition.

          Absolutely positioned so it cannot add height to a bar whose constant
          height is load-bearing. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-blood-500 transition-opacity duration-200",
          isPending ? "cr-filter-pending opacity-100" : "opacity-0",
        )}
      />

      <Row label="Sport">
        <Pill onClick={() => set("sport", "")} active={selected.sport.size === 0}>All</Pill>
        {FILTER_SPORTS.map((s) => (
          <Pill key={s.slug} onClick={() => toggle("sport", s.slug)} active={selected.sport.has(s.slug)}>
            {s.label}
          </Pill>
        ))}
      </Row>

      {/* The toggle. ALWAYS present, so its row is part of the constant box. */}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-1 text-2xs font-bold uppercase tracking-wider text-fog transition-colors hover:border-ink-700 hover:text-mist"
      >
        <SlidersHorizontal className="size-3" aria-hidden />
        {open ? "Fewer filters" : "More filters"}
        {activeCount > 0 && (
          <span className="rounded-full bg-blood-500 px-1.5 text-3xs font-black text-white tabular-nums">{activeCount}</span>
        )}
        <ChevronDown className={cn("size-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      {/* ── OUT OF FLOW ──────────────────────────────────────────────────────
          `absolute`, so expanding and collapsing this panel cannot reflow the
          list behind it. This is the whole fix: the sticky bar's layout box is
          a constant, and only the panel's own opacity and transform animate.

          Scrolls internally rather than growing without bound — a promotion row
          on a busy month is long, and a panel taller than the screen would put
          its own Clear button out of reach. `overscroll-contain` stops a flick
          past its end from scrolling the list underneath. */}
      <div
        ref={panel}
        className={cn(
          "cr-overscroll-contain absolute inset-x-0 top-full max-h-[60vh] origin-top space-y-3 overflow-y-auto border-b border-ink-800 bg-ink-950/98 px-4 pb-3 pt-1 backdrop-blur-xl",
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
        )}
        aria-hidden={!open}
        inert={open ? undefined : true}
      >
        {facets.promotions.length > 0 && (
          <Row label="Promotion">
            <Pill onClick={() => set("promotion", "")} active={selected.promotion.size === 0}>All</Pill>
            {facets.promotions.map((p) => (
              <Pill key={p.value} onClick={() => toggle("promotion", p.value)} active={selected.promotion.has(p.value)}>
                {p.label} <Count n={p.count} />
              </Pill>
            ))}
          </Row>
        )}

        {facets.countries.length > 0 && (
          <Row label="Location">
            <Pill onClick={() => set("country", "")} active={selected.country.size === 0}>Anywhere</Pill>
            {facets.countries.map((c) => (
              <Pill key={c.value} onClick={() => toggle("country", c.value)} active={selected.country.has(c.value)}>
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
              active={(selected.status || "upcoming") === s.value}
            >
              {s.label}
            </Pill>
          ))}
          <span className="mx-1 w-px shrink-0 self-stretch bg-ink-700" aria-hidden />
          {WINDOWS.map((w) => (
            <Pill
              key={w.value}
              onClick={() => set("when", selected.when === w.value ? "" : w.value)}
              active={selected.when === w.value}
            >
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
            className="tap inline-flex min-h-9 items-center gap-1 rounded-full border border-ink-700 px-3 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300"
          >
            <X className="size-3.5" /> Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
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
        // min-h-9: a 36px tap target. The pills were 30px, which is under every
        // published minimum and this is the most-tapped control on the site.
        "tap flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
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
