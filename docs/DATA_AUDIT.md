# Data pipeline audit — fighters, rankings, champions

**Phase 1 deliverable. No code has been changed.**

Scope: every path that creates or mutates a `Fighter`, `Ranking`, `Champion` or
`Title`, plus the cron schedule that drives them. Read against the working tree
at `6268327`.

The conclusion up front: **the reported symptoms are not ranking bugs.** Three
of them are a no-op cron, a sample-data fallback and a computed-not-ingested
P4P. The underlying architecture problem is that the system has no *evidence*
layer — it resolves conflicts destructively at write time and keeps no record of
what it discarded, so nothing about the current state is explainable.

---

## 1. Symptom → cause

| Reported | Actual cause | Evidence |
|---|---|---|
| UFC champions occasionally outdated | **The champions cron is a no-op.** `case "champions": case "people":` logs `refresh:noop` and returns. Champions are *only* ever written as a side effect of rank-0 rows inside the ranking connector ingest, which runs **weekly**. | `src/lib/scraper/runner.ts:326`, `src/lib/rankings/ingest.ts:147` |
| UFC P4P sometimes incorrect | **P4P for Boxing and MMA is computed, not ingested** — a rating engine derives it from `Fighter.wins/losses`. The official UFC P4P list *is* parsed and stored, but under `organisation="UFC"`, while the generated list is stored under `organisation=""`. Two P4P boards coexist. | `src/lib/rankings/generate.ts`, `runner.ts:243–268`, `connectors/ufc.ts:56` |
| Some promotions missing rankings | Only two connectors exist (`ufc-mma`, `wba`), both behind `RANKINGS_INGEST_ENABLED` **and** a per-source licence flag. Everything else has no provider at all. | `src/lib/rankings/connectors/index.ts`, `sources.ts` |
| Rankings look wrong / stale | **The public page falls back to hardcoded sample data** dated `2026-05-28` when the query returns nothing, flagged only by a small `SampleDataNote`. | `src/lib/data/rankings.ts:27`, `src/app/rankings/page.tsx` |
| Fighters in events but not Registry | Correct — but they *are* `Fighter` rows. The gap is that they are created by name-slug with no external id, no alias, no bio, so they are unmatched fragments rather than registry entries. | see §2 |
| User fighter profiles aren't canonical | **The signup path deliberately creates a duplicate**: on slug collision it appends `-2`, `-3`. A user named "Jon Jones" becomes `jon-jones-2`, a second identity. | `src/lib/repo.prisma.ts:209` |
| Fighter records stale | `applyDerivedRecords` runs only inside the `p4p` job, in `mode: "grow"`. | `runner.ts:260` |

**Correction to an earlier reading of my own:** I first concluded that
`refresh-champions` and `refresh-p4p` were never scheduled, because no
`render.yaml` line names them. They *are* scheduled — `gf-cron-daily` curls them
in a shell `for` loop, which a grep for the URL does not see. The routes run
daily. The champions route simply does nothing when it does.

The one route with no schedule anywhere is `refresh-people` — and it is also a
no-op, so nothing is currently lost by that.

---

## 2. Fighter identity — nine creation paths, one unused resolver

```
src/lib/events/ingest.ts:35        upsert where { slug: slugify(name) }
src/lib/odds/ingest.ts:30          upsert where { slug: slugify(name) }
src/lib/scraper/ingest.ts:24       upsert where { slug: slugify(name) }
src/lib/rankings/ingest.ts:92      findUnique slug → create
src/lib/rankings/curated/ingest.ts:46  findUnique slug → create
src/services/sync/persist.ts:97    resolveFighter(source, externalId, name) ← the only matcher
src/services/sync/persist.ts:436/439
src/lib/repo.prisma.ts:209         create with slug-2, slug-3 on collision  ← creates duplicates
```

**Eight of nine identify a human being by a slug derived from their display
name.** That is the architecture, not an oversight in one file: `fighterSlug()`
is exported from `ingest-rules.ts` and described as *"Stable → dedupes by
slug"*.

What that means in practice:

- `Ilia Topuria` and `Ilía Topuria` are one fighter (accents are stripped). Good.
- `Alexander Volkanovski` and `Alex Volkanovski` are **two**.
- `Jon Jones` (MMA) and any boxer of the same name are **one**, silently merged,
  and the second source's `sport` is deliberately not written — so the merged
  row keeps whichever sport arrived first.
- A fighter who changes their registered name gets a **new** row and their bout
  history splits.

Meanwhile `src/lib/entities/resolve.ts` is a genuinely good identity layer:
pure, deterministic, a ranked ladder of exact key comparisons
(`name_exact → alias → nickname → name_loose → paternal → initial → translit →
acronym`), returning **`ambiguous` rather than guessing** on a tie, with stated
per-rung confidences and an `OPEN_SET_FLOOR` that refuses weak rungs against the
whole table.

**Nothing calls it.** `resolveFighterByName` has exactly two references, both
inside its own module. The correct matcher exists and no ingest path uses it.

### The wasted evidence

| Table | Writes | Reads |
|---|---|---|
| `FighterExternalId` | 4 | **0** |
| `FighterAlias` | 3 | 1 |
| `RankingSnapshot` | 2 | **0** |
| `ProviderSync` | **0** | 1 |

`FighterExternalId` is the finding that matters most. Sherdog/Tapology/provider
ids are being *collected and never used to match anything*. The single highest-
value change in this whole programme is to make identity resolution read that
table first — the data is already there.

`ProviderSync` is the inverse: the observability model Phase 10 asks for already
exists in the schema with a reader and **no writer**. The same shape as the
reports queue that accumulated rows nobody looked at.

---

## 3. Rankings — the missing evidence layer

`Ranking` is `@@unique([weightClassId, isPoundForPound, fighterId, organisation])`.
**One row per fighter per division per organisation.** There is nowhere to put a
second provider's opinion.

So reconciliation happens at write time and destructively:

```ts
if (!shouldWriteRanking(existing?.source, connector.id)) { skipped++; continue; }
await prisma.ranking.upsert({ ... })   // the loser is discarded, unrecorded
```

`shouldWriteRanking` compares trust tiers and lets the higher one overwrite. It
is a reasonable *rule*; the problem is that it is applied to a table that can
only hold the winner. Consequences:

- **A conflict cannot be detected**, because the losing value never lands.
- **A ranking cannot explain itself** — the row keeps `source` and an optional
  `evidence` blob, but no `sourceUrl`, no `effectiveDate` (the source's own
  publication date is parsed into `RankingEntry` and then **dropped** at
  persistence), no `fetchedAt`, no confidence.
- **Trust is evaluated against a string.** `trustOf(existing.source)` looks the
  stored string up in a registry; an unknown string silently scores
  `TRUST.unknown = 40`.
- Order matters. A weekly run of two connectors gives a different final state
  depending on which ran first, whenever trust ties.

There is no cheap-check layer either. Every run re-fetches, re-parses and
re-writes identical data, and appends a `RankSnapshot` row **per fighter per
run** whether or not anything changed. The media pipeline already solved this
properly (`fetchImageConditional` with ETag/If-Modified-Since, hash comparison,
`unchanged-304` and `unchanged-hash` outcomes); rankings do none of it.

`notifyRankingChange` is also awaited **inside the per-row write loop**.

---

## 4. Champions — the constraint caps history at two

```prisma
model Champion {
  body     SanctioningBody
  current  Boolean @default(true)
  @@unique([weightClassId, body, current])
}
```

A unique constraint on a **boolean** permits at most **two rows per (division,
body) for all time** — one `current: true`, one `current: false`. The code
already knows and works around it by updating the champion in place and
resetting `since: null, defenses: 0` (`ingest.ts:80`), which means **every title
change destroys the previous reign's start date and defence count.**

Also missing: no `status` (interim / vacant / stripped / retired / lineal), no
`source`, no `confidence`, no `asOf`, no evidence, no link to the bout that
caused the change.

`Title` is the intended history model and has no unique constraint at all, no
status, and no provenance — so duplicate title rows are possible and unguarded.

**Nothing computes a champion.** There is no reconciliation, no derivation from
bout results, and the only writer is a side effect of a rank-0 ranking row.

---

## 5. Wikipedia

Used as an **HTML scraper** (`lib/scraper/wikicard`, `promotion-index`,
`year-page`), parsing article tables with cheerio. There is no Wikidata client
and no use of the Wikipedia REST/Action API anywhere in the tree.

That is the right target for Phase 6 — but note the audit's finding, not the
brief's assumption: Wikipedia is currently the **only** source of bout results
for BKFC and ONE, and the only kickboxing source. Demoting it to "secondary
evidence" for *rankings* is correct; demoting it globally would remove the only
provider several sports have.

---

## 6. What is already right, and should be kept

Not everything needs replacing, and the brief's "fix the system" should not
become "rewrite the parts that work":

- **`entities/resolve.ts`** — the identity ladder. Pure, deterministic,
  ambiguity-aware, tested. It needs *callers*, not a rewrite.
- **`RankingConnector`** — a clean provider interface with trust tiers, licence
  flags and a blocklist enforced in code. Phase 3's "RankingProviders" is
  substantially this, and it should be extended rather than replaced.
- **Parse-then-validate** in the UFC connector — refuses to publish a partial
  ranking (`< 10` divisions, `< 5` contenders, a rank appearing 3+ times). This
  is exactly the resilience Phase 6 asks for and is the pattern to copy.
- **`ImportConflict`** and the `locked` field concept — a conflict-recording
  mechanism already exists on the event/sync path.
- **The media lifecycle's conditional-GET machinery** — ETag, If-Modified-Since,
  content hashing, `unchanged` outcomes. Phase 5's incremental sync should reuse
  this shape rather than invent another.

---

## 7. Proposed architecture (for approval before implementation)

### 7.1 Evidence, not overwrite

Add a `RankingObservation` table: append-only, one row per
(provider, division, fighter, effectiveDate). Providers write **observations**;
they never write `Ranking`.

`Ranking` becomes a **projection** computed from observations by a reconciler,
carrying `decidedBy`, `agreementCount`, `conflictsWith` and the observation ids
behind it. Then "why is this fighter #3?" is answerable, an official list can
outrank Wikipedia *without deleting what Wikipedia said*, and a provider going
dark degrades to the next-best evidence instead of freezing the last write.

Same shape for `ChampionObservation` → a computed `Champion` with a real
`status` enum and a `TitleReign` history model that is not capped at two rows.

### 7.2 Identity: one resolver, external-id first

One `resolveOrCreateFighter()` that every ingest path calls, resolving in order:

1. `FighterExternalId (source, externalId)` — exact, already collected, unused
2. `FighterAlias.normalized`
3. the deterministic ladder from `entities/resolve.ts`, open-set
4. birthdate + nationality corroboration to break a tie
5. **no confident match → `IdentityCandidate` for review**, never an auto-merge

The eight slug-based paths collapse into it. Fighter signup routes through the
same function and produces `MATCH_CONFIDENT` / `MATCH_POSSIBLE` / `NO_MATCH`
instead of a `-2` slug.

### 7.3 Incremental sync

`ProviderRun` (populate the existing `ProviderSync`), plus per-provider
`etag` / `lastModified` / `payloadHash` / `lastCheckedAt` / `lastChangedAt`.
Unchanged payload → record the check, write nothing, append no snapshot.

---

## 8. Decisions I need from you before Phase 2

These change the design, and guessing them would be expensive to undo:

1. **Which providers are licensed?** The repo blocks BoxRec in code and gates
   everything behind per-source licence flags. Tapology and Sherdog have terms
   that need a decision from you, not from me. Wikidata (CC0) and official
   promotion pages are clearly safe.
2. **Should the sample-data fallback be removed?** I would delete it — serving
   hardcoded May-2026 rankings under a small note is the single most likely
   source of "the rankings are wrong". That is a visible product change.
3. **P4P for Boxing/MMA: ingest or compute?** The brief says "never invent
   data", which points at deleting the rating engine and showing nothing where
   no official list exists. That is a real reduction in coverage.
4. **`RANKINGS_ENABLED` is currently off.** Turning the feature back on is the
   owner decision the code comments defer to.

---

## 9. Sequenced plan

| Phase | Work | Risk |
|---|---|---|
| 2a | One `resolveOrCreateFighter`; external-id-first; route all 9 paths through it | Medium — behaviour change on every ingest |
| 2b | `IdentityCandidate` review queue + admin surface | Low — additive |
| 2c | Backfill: detect existing duplicates, propose merges, merge only on review | **High — needs the audit script first, no automatic merging** |
| 3 | `RankingObservation` + reconciler; connectors write observations | Medium |
| 4 | `ChampionObservation` + `TitleReign`; retire the boolean unique | Medium — needs a migration |
| 5 | Conditional GET + `ProviderRun`; stop rewriting identical data | Low |
| 6 | Wikidata/Wikipedia API provider replacing HTML where structured data exists | Low — additive |
| 10 | Admin observability reading `ProviderRun` + conflicts + review queue | Low |

Phase 2c is the one to be careful about. There is an existing
`lib/admin/merge-fighters.ts` that handles the FK repointing; the missing piece
is *deciding* what to merge, and that must go through review rather than a
confidence threshold.
