# GlobalFight — RC-5.1 UX Compression

**Date:** 2026-07-24 · **Branch:** `rc5/event-media` (not pushed)
Reducing vertical space + cognitive load on the two tallest surfaces. Measured
before/after. Companion: `EVENT-EXPERIENCE.md`, `PREDICTION-IA.md`.

---

## 1. Event predictions — collapsed by default

**Problem.** The event page rendered every bout's full prediction module top to
bottom. A 12-bout card meant scrolling past all twelve to reach the card talk +
coverage.
**Fix.** `CollapsibleFights` (client) renders the top bouts (main event + co-main
+ one = `initialVisible=3`) and tucks the rest behind a single **"View N more
predictions"** toggle. Hidden modules are NOT mounted while collapsed (Children
slice), so both DOM and scroll drop until the reader opts in. Applied by
flattening the card blocks into one ordered list.
**Files.** `components/event/collapsible-fights.tsx` (new), `app/events/[slug]/page.tsx`.

**Measured** (12-bout event, mobile 420px, `#main` scroll region):

| | Card region height |
|---|---|
| Expanded (old behaviour) | 8,697 px |
| Collapsed (new default) | 4,044 px |
| **Reduction** | **54% shorter · 4,653 px saved** |

Exceeds the 30–40% target.

## 2. Signup role selector — one compact grid

**Problem.** The role picker stacked four labelled groups ("In the cage", "The
business", …), each with its own header + a verbose intro paragraph — tall enough
to push email/password well below the fold.
**Fix.** One flat `grid-cols-2 sm:grid-cols-3` of all 13 roles, compact cards
(icon-less, `line-clamp-1` blurb), selected card lifts + shows a check. Dropped
the group headers and the paragraph (kept a "change anytime" hint).
**Files.** `app/account/page.tsx`.
**Result.** All 13 roles visible in a 2-column mobile grid with the Username field
immediately below — verified in browser (mobile 420px).

## 3. Watch / Tickets on the event detail page

The provider resolver (`lib/events/providers`, shipped in the prior RC-5 commit)
is now also wired into the event **header**: **Watch · ESPN+ ↗** and **Tickets ·
UFC.com ↗** for a UFC event, matching the card. Verified in browser.

---

## Validation
TSC 0 · ESLint 0 errors · unit **103/103** · production build compiled ·
browser-verified (collapse toggle, signup grid, event-header watch/tickets).

## Accessibility
Collapse toggle: `min-h-11` (44px), `aria-expanded`, focus-visible ring. Role
cards: `aria-pressed`, ≥44px tap area, title tooltip. No horizontal scroll at
420px on either surface.

## Remaining roadmap (not in this pass)
Per-event **verified** watch/ticket data + provenance (needs a real per-event data
source — promotion default remains the honest fallback); the full **EventMedia
image-ingestion pipeline** (the "every card has a premium visual" fix); entity
normalization for fighter/event names; result-verification auto-fetch;
history-aware back navigation + scroll restoration. See `EVENT-EXPERIENCE.md`.
