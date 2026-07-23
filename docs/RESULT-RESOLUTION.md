# GlobalFight — Result Resolution & Prediction Integrity

**Date:** 2026-07-24 · **Branch:** `harden/wave0-production-blockers` (not pushed)
How a completed fight's outcome flows from an external source to a graded
prediction, and the guarantees that keep it trustworthy. Companion:
`HARDENING.md`, `RC-1-CERTIFICATION.md`.

> **Measurement note.** The local certification DB was truncated by RC-1's
> integration run, and live scraping is gated, so the production count of
> unresolved fights could not be measured from this environment. The work here is
> a **code-level trace + the structural fixes** it surfaced, each unit-tested. The
> new `resultOps()` telemetry (below) is what will measure the real backlog once
> pointed at production.

---

## The pipeline (two distinct stages)

Resolution is TWO stages, and "unresolved fight" can mean a failure in either:

```
  external sources                          user picks
        │                                        │
  ┌─────▼──────────────┐              ┌──────────▼───────────┐
  │ STAGE 1: RESULT     │            │ STAGE 2: PICK          │
  │ INGESTION           │            │ RESOLUTION             │
  │ providers → aggregate│  Fight     │ resolveDuePicks →      │
  │ → merge (confidence) │  .result   │ resolveFightPicks      │
  │ → persist.ts write   │──────────▶ │ grade → rep → cards →  │
  │ sets Fight.result    │  set here  │ notify → activity →    │
  └──────────────────────┘            │ battles → leaderboards │
        cron: refresh-*               └────────────────────────┘
                                        cron: resolve-picks
```

- **Stage 1** (`src/services/*`, `refresh-results`/`refresh-*` crons) sets
  `Fight.result` / `winnerId` / `method` from the providers.
- **Stage 2** (`src/lib/intelligence/resolve.ts`, `resolve-picks` cron) grades
  every pick against that result and fans out the consequences.

### Where "completed fights remain unresolved" comes from
`resolveDuePicks` only selects fights where `result != SCHEDULED`. So Stage 2 is
gated on Stage 1. If a completed bout's `result` is never set — or is **reverted**
to SCHEDULED — it looks unresolved to users and its picks never pay out. **Stage 2
is not the culprit** (it is idempotent and well-guarded, below); the risk lives in
Stage 1's write.

---

## Provider priority & conflict resolution (Stage 1)

`src/services/aggregator/priority.ts` defines, **per sport**, an ordered list of
source keys (highest trust first). `merge.ts` combines providers within a single
sync run by **per-field confidence** (higher wins; equal keeps the incumbent).
Decision order for a result:

1. **Operator override** — fields in `Fight.lockedFields` are never overwritten by
   any sync (`stripLocked`). A human's verified correction is final.
2. **Highest-priority provider** with a result for that field, by the per-sport
   ranking (official/promotion > licensed API > scraper/news).
3. **Equal confidence** keeps the already-stored value (no thrash).
4. **Never guess** — absent a result, the bout stays SCHEDULED (honest empty
   state) rather than inventing an outcome.

Per repo notes, BKFC/ONE results currently come from the **wikicard** (Wikipedia)
provider — the only bout-results source for those promotions — so a gap there is
the most likely production cause of missing results.

---

## Result integrity — the no-downgrade guard (NEW)

**Bug found in the trace.** `persist.ts` wrote `result: stub.result` on every sync
and only protected operator-locked fields. A later run whose merged stub carried
`SCHEDULED` (a schedule-only provider ran, or the results provider briefly dropped
the bout) would overwrite a decided `WIN` back to `SCHEDULED` — **un-deciding a
completed fight and desyncing already-graded picks.**

**Fix.** `src/lib/intelligence/result-integrity.ts` · `preventResultDowngrade()`,
applied in `persist.ts` before `stripLocked`:

- Once a fight is **decided** (`WIN`/`LOSS`/`DRAW`/`NO_CONTEST`), an incoming
  update that would set `result = SCHEDULED` has result + `method`/`winnerId`/
  `roundEnded` **stripped** — the decided outcome stands.
- `SCHEDULED → decided` (first real result) is allowed.
- `decided → different decided` (an overturned/corrected result) is allowed.
- Pure, side-effect-free, 6 unit tests (`__tests__/result-integrity.test.ts`).

This is the concrete form of the brief's rule: *never overwrite verified data with
lower-confidence data.*

---

## Idempotency guarantees

- **Stage 2 (picks):** each pick is graded only while `correct IS NULL`; the
  fight is stamped `picksResolvedAt` when done, and the due-query excludes stamped
  fights. Each pick's payout is its own `$transaction` — one user can't half-apply
  and one failure can't poison the card. Re-running `resolve-picks` is a safe
  no-op. (Proven by RC-1 integration test: *"resolution is idempotent — a re-run
  grades nothing again."*)
- **Stage 1 (results):** writes upsert by slug; the no-downgrade guard makes a
  re-run with a weaker stub a no-op on the result. Corrections still flow.

---

## Operational visibility (NEW)

`src/lib/intelligence/result-ops.ts` · `resultOps()` exposes the two failure modes
as counts + samples, emitted on **every `resolve-picks` cron run** (logged loudly
when non-zero, returned in the JSON):

- **`awaitingResults`** — bouts whose event is over (>12h grace) but `result` is
  still `SCHEDULED`. The **human review queue**: a dead feed, a slug mismatch, or
  missing coverage. This is what to watch to guarantee "never remains unresolved."
- **`resolutionLag`** — bouts with a decided result whose picks were never graded
  (a cron that never ran / errored past this fight). Payouts owed and unpaid.

Both queries are cheap and indexed (`Fight.@@index([date, result])` +
`picksResolvedAt`).

---

## Manual override flow
An operator edits a fight (`src/lib/admin/fights.ts`), which sets the value and
adds the field to `Fight.lockedFields`. Every subsequent sync skips locked fields
(`stripLocked`). To hand a field back to automation, unlock it. The no-downgrade
guard is independent of and complementary to locking.

## Failure recovery
- Missing result (feed gap): appears in `awaitingResults`; operator sets it
  manually (locked) or waits for the provider. Setting it triggers Stage 2 on the
  next `resolve-picks`.
- Wrong result later corrected: allowed (decided→decided); Stage 2 does NOT
  re-grade already-graded picks automatically — a correction after grading is an
  operator action (documented gap, see Remaining).
- Cron miss: `resolve-picks` is idempotent and catches up all due fights on the
  next run; `resolutionLag` shows the backlog meanwhile.

## Remaining / recommended (not done here)
- **Result provenance columns** (`resultSource` / `resultVerifiedAt` /
  `resultConfidence` / `verificationStatus`): the brief asks for per-result
  provenance stored on the row. The aggregator computes confidence but it is not
  persisted. Additive, nullable columns + wiring in `persist.ts` — a schema
  change (needs `db push`), deferred from this branch-only pass. The no-downgrade
  guard delivers the core integrity win without it.
- **Re-grade on correction**: when a decided result is corrected AFTER picks were
  graded, Stage 2 should re-open and re-grade that bout's picks (reverse the old
  payout, apply the new). Currently operator-driven. Needs a reversal path in
  `resolve.ts` + tests.
- **Multi-source confirmation for scraped results** (require ≥2 trusted news
  confirmations before accepting a news-only result): the priority engine ranks
  sources but does not yet require corroboration for the lowest tier.
- Expose `resultOps()` in an admin review-queue UI (currently cron log + JSON).
