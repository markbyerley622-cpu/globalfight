# GlobalFight — Event Experience (RC-5)

**Date:** 2026-07-24 · **Branch:** `rc5/event-media` (not pushed)
Making the events surface feel like a premium sports product. This pass ships the
**Watch + Ticket provider resolvers** (the "TBA everywhere" fix). The larger RC-5
brief (media pipeline, faceoff ingestion, result-verification engine, back-nav,
scroll restoration) is scoped as roadmap below.

---

## Problem
Watch/Tickets pills said **"TBA"** on almost every card, because they read
per-event `broadcaster` / `ticketUrl` fields that the feeds rarely populate.
Collecting that per-event by hand doesn't scale (dozens of new events/week).

## Solution — resolve by promotion, not per event
`src/lib/events/providers.ts` — two pure resolvers keyed off the promotion slug
(`resolvePromotion`). Priority:

1. **Explicit per-event data** (feed `broadcaster` + `eventUrl`, or `ticketUrl`) —
   always wins, marked `exact: true`.
2. **Promotion default** — the promotion's primary broadcaster + its OWN official
   watch/ticket page (`exact: false`).
3. **null → "TBA"** — only for unknown/various promotions (e.g. a generic "Boxing"
   card), which is honest.

Every destination is the promotion's **own official site** — no invented
providers, no third-party deep links that could be regionally wrong. The label
names the primary broadcaster as a hint; the link goes to the authoritative
source where exact per-event details live.

### Provider table (verifiable, official)
| Promotion | Watch (primary) | Tickets |
|---|---|---|
| UFC / Road to UFC / DWCS | ESPN+ · ufc.com | UFC.com |
| ONE Championship | Prime Video · watch.onefc.com | onefc.com/events |
| PFL / Bellator | ESPN / DAZN · pflmma.com | pflmma.com |
| BKFC | BKFC App · bkfc.com | bkfc.com/events |
| GLORY | DAZN · glorykickboxing.com | glorykickboxing.com |
| RIZIN | LIVENOW · rizinff.com | rizinff.com |
| KSW | KSW TV · kswmma.com | kswmma.com |
| Cage Warriors | UFC Fight Pass | cagewarriors.com |
| Oktagon | Oktagon.tv | oktagonmma.com |
| Boxing / Various | — (TBA) | — (TBA) |

**Known simplification:** region/PPV nuance means the label is a "typically on X"
hint; the link resolves to the authoritative source. Per-event/region metadata is
a future enrichment.

## Surfaces wired
- **Event card** (`components/events/event-card.tsx`) — WATCH / TICKETS pills.
- **Event detail** (`components/event/event-header.tsx`) — Watch / Tickets meta rows.

## Verification
- 8 unit tests (`__tests__/providers.test.ts`): known promotions resolve; explicit
  data wins; unknown → null; malformed URLs rejected. Unit total 95 → **103**.
- Browser-verified: UFC card → "WATCH ESPN+" / "TICKETS UFC.com"; ONE → "Prime
  Video"; BKFC → "BKFC"; a generic Boxing card correctly stays "TBA".
- TSC 0 · ESLint 0 · production build compiled.

---

## RC-5 roadmap (NOT in this pass — scoped, not built)

The provider resolvers are the first of the "media services" the brief calls for.
Remaining, in priority order:

1. **EventMediaService (image pipeline)** — a resolver that, per event, scores and
   caches the best hero: official poster → promotion artwork → **transparent-PNG
   fighter faceoff** → article hero → promotion hero → branded fallback → gradient.
   Persist the chosen URL so it's computed once, never re-fetched, no flicker. The
   current `lib/event-artwork.ts` covers hero/poster/fighter-faceoff/gradient from
   data already on hand; the gap is *ingesting* that imagery for new events
   (Wikimedia headshots, promotion assets, article thumbnails — licensed only).
2. **Entity normalization for names** — fighter/event names still carry HTML
   entities (`Gaston &#39;Tonga&#39;`); extend the RC-2 `normalizeText` to those
   ingest paths + backfill.
3. **ResultVerificationService** — multi-source confirmation (≥2 trusted sources →
   verified), provenance columns (source/timestamp/confidence/review-state),
   review queue UI. The no-downgrade guard + telemetry already shipped
   (`RESULT-RESOLUTION.md`); this is the auto-fetch + provenance layer.
4. **NavigationService** — intelligent back navigation (history-aware, safe
   fallback) + scroll restoration across fighter/article/event/settings.
5. **Branded fallback graphic** — a premium generated (non-AI) card treatment
   (promotion logo + fighter marks + date) so an art-less card still looks
   intentional, ahead of the gradient.
