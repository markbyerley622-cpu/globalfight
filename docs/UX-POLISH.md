# GlobalFight — UX Polish Sprint (RC-2)

**Date:** 2026-07-24 · **Branch:** `harden/wave0-production-blockers` (not pushed/deployed)
Product-refinement pass toward a polished consumer sports app. Every event card
should answer six questions in seconds: **who · what · when · where · how to
watch · how to attend.** Each change verified TSC 0 / ESLint 0 / unit / build,
and spot-checked in a real browser against a production `next start`.

## Status

| Phase | Item | Status |
|---|---|---|
| 1 / 10 | Event-card image hierarchy | ✅ done |
| 2 | Watch + Tickets as first-class actions | ✅ done |
| 3 | Primary CTA hierarchy | ✅ done |
| 4 | Mobile nav (logo → /events, delete Map/Gyms/Events selector) | ✅ done |
| 6 | Partners + Breaking only on /events | ✅ done |
| 7 | Venue → in-app map deep-link | ✅ done |
| 9 | Event-card polish (shape-matched skeleton) | ✅ done |
| 5 | Event results resolver audit | ⏳ pending (backend-heavy) |
| 8 | Predictions IA (two systems) | ⏳ pending (larger) |
| 11 | Performance re-measure (no regression) | ⏳ pending |

---

## Phase 1 / 10 — Event-card image hierarchy

**Problem.** Most event cards were bare gradients. **Root cause.** `EventCard`
checked only `posterUrl`; the query didn't even fetch `heroUrl` or fighter
photos, so there was nothing else to fall back to.
**Design decision.** A deterministic selector (`src/lib/event-artwork.ts`) picks,
in priority order: event **hero** (16:9, best fit for the landscape slot) →
vertical **poster** → a composed **fighter-vs-fighter** background (the two
main-event photos, blue mirrored so they face centre) → promotion **gradient**
(last resort only). Fighter photos are the most commonly-available imagery, so
this is what puts real pictures on the majority of previously-blank cards.
**Files.** `src/lib/event-artwork.ts` (new, 6 tests), `src/lib/events-query.ts`
(fetch `heroUrl` + main-event fighter images, media-safe-gated), `src/components/
events/event-card.tsx`.
**Trade-offs.** Article-hero and dedicated promotion-branding tiers (plan tiers
3/4/6) need extra joins — deferred; they slot in ahead of the gradient later.
No layout shift: the slot is fixed-height and the choice is deterministic.

## Phase 2 — Watch + Tickets

**Problem.** How-to-watch and how-to-attend (two of the six questions) were not
surfaced. **Decision.** A two-column WATCH / TICKETS row on every upcoming card:
WATCH shows the broadcaster (or `TBA`); TICKETS shows a buy link when a
`ticketUrl` exists (accent-styled, external) or `TBA`. Broadcaster moved out of
the meta row into WATCH to remove repetition. **Files.** `event-card.tsx`,
`events-query.ts` (fetch `eventUrl`/`ticketUrl`).
**Note.** Caught + fixed a real bug in verification: an `onClick` on the pill
made a server component illegal ("Event handlers cannot be passed…"); removed it
(the card isn't a wrapping link, so it was unnecessary).

## Phase 3 — Primary CTA hierarchy

**Problem.** The card's main action was a faint text link while the SCHEDULED
status read loudest. **Decision.** Promote it to a filled, high-contrast, larger,
tappable button ("Full card" / "Watch live" / "View results" by lifecycle) — the
visual anchor of the action row. **Files.** `event-card.tsx`.

## Phase 4 — Mobile navigation

**Problem.** An obsolete Map / Gyms / Events sub-selector, and the logo did not
return to a clean events home. **Decision.** Removed `LOCATION_SECTION` (the
sub-selector) — Map/Gyms live under the Location pillar and Events is a top-level
nav item, so the shared selector was dead IA; the routes stay reachable from the
main nav (no orphans). Logo now always links to a clean `/events` (no preserved
sport/location/date filters). **Files.** `section-tabs.tsx`, `app-shell.tsx`.

## Phase 6 — Partners & Breaking news

**Problem.** The Partners strip and Breaking-news ticker rendered on every page.
**Decision.** Both are promotional chrome for the events home — gated to
`pathname === "/events"` only. Verified absent on `/leaderboard`. **Files.**
`app-shell.tsx`.

## Phase 7 — Venue → in-app map

**Problem.** Venue/location bounced out to Google Maps. **Insight.** Events are
already plotted on our map, geocoded from venue/city via the gazetteer
(`resolvePoint`). **Decision.** The event header's Location now deep-links to
`/map?lat&lon&z` (primary, in-app); Google Maps becomes a secondary "Directions ↗"
fallback. The map reads the params and flies there. **Bug caught in verify:** the
first cut set focus on mount, but the map (dynamic, `ssr:false`) mounts *after* and
the canvas drops a focus set before it exists — the map landed on its default
[22,12] centre. Fixed by stashing the target and applying it in the map's
`onReady`. Verified: `/map?lat=24.71&lon=46.68` centres on Riyadh with the event
pin. **Files.** `event-header.tsx`, `map-explorer.tsx`.

## Phase 9 — Card polish

The interactive fundamentals were already in place (global `:focus-visible`
rings, card hover, adequate tap padding). The real gap was the loading state: the
generic avatar-card skeleton didn't match the redesigned image-topped card, so the
grid popped on load. Added an **`EventsSkeleton`** whose silhouette matches the new
card (image band → meta → watch/tickets → actions) and the real grid
(`sm:grid-cols-2`), so the list settles in place. **Files.** `ui/skeleton.tsx`,
`app/events/loading.tsx`.

---

## Measurements
Bundle unchanged (shared First Load JS 102 kB). Card image slot is fixed-height
with deterministic selection → no new CLS. Full field re-measurement (LCP/CLS/
INP) is Phase 11, to run on staging (local numbers are infra-confounded — see
`RC-1-CERTIFICATION.md`).

## Remaining / Future
Phases 5 (resolver audit — idempotent, evidence-based, documented decision tree),
7 (venue deep-link into the in-app map), 8 (predictions IA — distinguish the
Global Prediction Market from the head-to-head CombatReviews Prediction), 9
(spacing/typography/tap-targets/skeletons/focus polish), 11 (performance). See
the sprint plan for detail.
