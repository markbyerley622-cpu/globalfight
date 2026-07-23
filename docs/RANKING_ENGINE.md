# GlobalFight — Ranking Intelligence Engine

**Date:** 2026-07-24 · **Branch:** `rc6/rankings` (not pushed) · **Status:** foundation + contract only

> **The single most important finding.** The rankings UI is **already built** —
> `/p4p` has a gold/silver/bronze **podium** with fighter photos + movement (↑↓) +
> Curated/Rating-engine trust badges; `/rankings/[slug]` + `/leaderboard?board=fighters`
> exist; the `Ranking` model already carries `rank / previousRank / movement /
> source`. The feature is **deliberately gated OFF** via `RANKINGS_ENABLED`
> (default false): *"existing ranking data could not be traced to a licensed
> source, so it has been withdrawn."* So the work is **connecting a compliant
> source**, not building UI or a schema. Re-enabling reverses a compliance
> decision — an **owner call** (see Compliance).

---

## Architecture (4 layers)

```
Layer 1  Source Connectors   one parser per source, RankingConnector interface,
                             returns normalized entries only — no Prisma, no biz logic
        ↓
Layer 2  Normalizer          RankingEntry (name, weightClass, rank, gender, kind,
                             country, organisation, sport, effectiveDate, sourceUrl)
        ↓
Layer 3  Identity Resolution resolve to an existing Fighter (name+country+aliases,
                             external IDs where permitted); low confidence → review queue
        ↓
Layer 4  Storage             versioned snapshots (never overwrite); compute movement
                             (↑/↓/NEW/OUT) vs the previous snapshot; invalidate cache; notify
```

Built in this pass (foundation, `src/lib/rankings/`):
- **`connector.ts`** — Layer 1/2 contract: `RankingEntry`, `RankingConnector`,
  `TRUST` tiers → confidence, `normalizeWeightClass`.
- **`sources.ts`** — the source registry, tiered, with a per-source `licensed`
  gate. `ingestibleSources()` returns **[] until an owner opts a source in**.
- Tests: nothing ingestible by default; BoxRec flagged never-ingest; official
  bodies = Tier 1/100 confidence.

NOT built (next stages, gated on the compliance decision): connector
implementations (parsers), identity resolution, snapshot versioning + movement
compute, weekly runner, notifications, admin dashboard.

## Source tiers (from the owner's list)

| Tier | Trust | Sources |
|---|---|---|
| 1 · Official | 88–100 | WBA/WBC/WBO/IBF (female lists provided), EBU (male+female, monthly PDF), Boxing Ireland, IPBA (India) |
| 2 · Secondary | 60–80 | British Boxers (interim UK), FightersRec (Pakistan) |
| 3 · Media | 80 | BoxingScene; Commonwealth via Boxing News (paywalled → manual only) |
| Excluded | — | **BoxRec** — terms forbid bulk ingest; reference / identity-matching only, never ingested |

Every source starts `licensed: false` + `connectorReady: false`. The engine
ingests a source only when BOTH are true — a deliberate, auditable opt-in.

## Data model (already present)
`Ranking { rank, previousRank, movement: RankMovement, source, weightClassId,
fighterId }` + `WeightClass` + `Champion`. Snapshot **versioning** (browse
July/Aug/Sept, keep history) needs an additive `RankingSnapshot(effectiveDate,
organisation, …)` table — a future additive migration.

## Weekly cron
`fetch → normalize → resolve identity → persist snapshot → diff vs last → compute
movement → invalidate cache → notify followers`. Scheduled weekly (render.yaml
already runs ranking crons; add the engine runner there). Idempotent: re-running
a week recomputes the same snapshot; movement is derived, never hand-set.

## Identity resolution
Resolve published names to existing `Fighter` rows via name + country + aliases
(+ external IDs where a source legitimately provides them). Uncertain matches go
to a review queue rather than creating duplicates — reuse the existing
fighter-dedupe path (`src/services/dedupe/fighters.ts`).

## Compliance (the decision to make)
Rankings were **withdrawn on purpose** for lack of a licensed source. Re-enabling:
1. **Preferred:** ingest **Tier-1 official sanctioning bodies** (WBA/WBC/WBO/IBF)
   + national federations — their own published rankings, attributed, with the
   "Official" badge. Confirm each body's terms permit it, then set `licensed:true`.
2. **Interim:** British Boxers for UK (owner-suggested) — badge as media, lower
   confidence.
3. **Never:** BoxRec bulk ingest (their terms) — reference only.
Flip `RANKINGS_ENABLED=true` only once ≥1 compliant connector is live and its
data is attributed.

## Registry
Ranked fighters resolve to `Fighter` rows via identity resolution (Layer 3), so a
newly-ranked fighter is created/linked in the registry as part of ingest — no
separate path. New fighters get the standard media-enrichment pipeline.

## Roadmap (in order)
1. Owner clears Tier-1 sources (compliance) → set `licensed:true`.
2. First connector (a Tier-1 body with clean structured data) → `RankingEntry[]`.
3. `RankingSnapshot` migration + movement compute + versioned browse.
4. Identity resolution into `Fighter` + review queue.
5. Weekly runner + cache invalidation + follower notifications.
6. Admin dashboard (failed parsers, last sync, imported/dupes/confidence, queue).
7. Flip `RANKINGS_ENABLED=true`. Then extend to more bodies + other sports by
   adding connectors — no engine rewrite.
