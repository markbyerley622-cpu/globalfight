# The data pipeline

How a fact gets from a provider into the product, and what stops it being wrong.

Companion documents: `docs/DATA_AUDIT.md` (what was broken and why),
`docs/FIGHTER_REGISTRY.md` (identity), `docs/RANKINGS.md` (rankings and
champions), `docs/CRON.md` (schedules).

---

## The shape

```
  provider ─► normalize ─► IDENTITY ─► observation ─► reconcile ─► projection ─► UI
                              │            │             │
                         canonical     append-only     pure,
                          fighter      immutable     tier-ordered
```

Four properties this shape has and the previous one did not:

1. **Evidence is kept.** A provider that loses a disagreement is still recorded,
   so the disagreement is visible.
2. **Decisions are explainable.** Every published row carries the observation ids
   behind it, the tier that decided it and the source's own publication date.
3. **Decisions are deterministic.** Reconciliation is a pure function of the
   evidence, so the outcome does not depend on which cron ran first.
4. **Nothing is invented.** When no usable evidence exists, the answer is *no
   data* — never a stale value, never a computed stand-in presented as a fact.

---

## Layers

| Layer | Owns | Must not |
|---|---|---|
| **Connector** (`lib/rankings/connectors/*`) | Fetch + parse one source into `RankingEntry[]` | Touch Prisma. Decide anything. |
| **Identity** (`lib/registry/identity`) | "Which canonical fighter is this?" | Guess below the threshold. |
| **Observation** (`lib/rankings/pipeline`) | Record what a source said | Publish. |
| **Reconcile** (`lib/registry/reconcile`) | Decide what we believe | Read a database — it is pure. |
| **Projection** (`pipeline`, `champions`) | Write `Ranking` / `TitleReign` | Invent a row with no evidence. |

A connector is added by implementing an interface. No layer above it changes.

---

## Parse, then validate — separately

The UFC connector is the pattern to copy. It parses, and then **validates before
publishing**:

- fewer than 10 divisions → refuse
- a division with fewer than 5 contenders → refuse
- the same rank appearing 3+ times → refuse (a 2-way tie is legitimate; three is
  parse drift)

A layout change therefore produces a **loud failure**, not a quietly truncated
ranking. That is the difference between a scraper that breaks and one that lies.

Because the validator throws, `recordFailure` increments a `failureStreak` on the
provider's checkpoint — so a provider that has been broken for eleven runs says
so, rather than being rediscovered by someone reading logs.

---

## Wikipedia, honestly

Wikipedia is **one provider**, at `ENCYCLOPAEDIC` tier. It can never overwrite an
official ranking or a title announcement.

But the audit's finding, which the brief's framing understates: Wikipedia is
currently the **only** source of bout results for BKFC and ONE (both render
results client-side), and the only kickboxing source at all. Demoting it for
*rankings* is correct. Removing it globally would delete several sports.

**Prefer structured data.** Wikidata (CC0) and the Wikipedia API before HTML
parsing; HTML only where neither publishes what is needed. Today the codebase has
no Wikidata client — every Wikipedia path is cheerio over article tables. That is
the next provider to build, and it is additive.

---

## Incremental sync

Every provider fetch should be able to answer "has anything changed?" cheaply,
and skip everything when the answer is no.

| Mechanism | Where |
|---|---|
| Payload hash (sorted, meaning-only fields) | `payloadHash()` |
| ETag / `If-Modified-Since` | `ProviderCheckpoint.etag` / `.lastModified` |
| `lastCheckedAt` vs `lastChangedAt` | `ProviderCheckpoint` |
| Failure streaks | `ProviderCheckpoint.failureStreak` |

The media pipeline proved this shape first (`fetchImageConditional`, with
`unchanged-304` and `unchanged-hash` as first-class outcomes). Rankings had none
of it: every run re-fetched, re-parsed and re-wrote identical rows, and appended
a `RankSnapshot` **per fighter per run** whether or not anything had changed.

Now a `RankSnapshot` is appended only when a rank actually moved.

---

## Query budget

- Identity resolution: **2 narrowing reads** (alias table + surname scan), then
  in-memory comparison. Never one query per candidate.
- Observation recording: one `createMany` per row with `skipDuplicates`; the
  hash check short-circuits the whole loop when nothing changed.
- Projection: one `groupBy` for the list of lists, then one bounded read
  (`take: 500`, ordered by `effectiveDate`) per list. No N+1 over fighters.

---

## Failure behaviour

| Failure | Result |
|---|---|
| One provider throws | Recorded on its checkpoint; other providers unaffected; nothing published from it |
| One row unresolvable | That row is skipped; the rest of the board publishes |
| Identity ambiguous | Provisional row + review candidate; ingest is never blocked on a human |
| All evidence stale | `null` → published as "no data" |
| Payload unchanged | Nothing written; `lastCheckedAt` advances, `lastChangedAt` does not |

---

## What is deliberately still open

Recorded rather than hidden:

- **No Wikidata provider yet.** The tier exists; the client does not.
- **The rating engine still runs** for Boxing/MMA P4P where no official list
  exists. It must be labelled as an internal rating, and whether to delete it is
  an owner decision (see `docs/RANKINGS.md`).
- **No backfill for existing duplicates.** The new resolver stops *new* ones. The
  ~10,000 fighters already in production were created under the slug key and have
  not been audited. That job needs an audit script first and a review queue
  second — never an automatic merge pass.
- **`WeightClass` is keyed by `(sport, name)`**, so UFC Lightweight and ONE
  Lightweight share a row despite different limits. Filtering by organisation
  still returns the right people in the right order; the divisional weight shown
  is the sport's, not the promotion's.
