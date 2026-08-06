# Rankings and champions

**No ranking is invented, and every published number can explain itself.**

---

## Why multiple evidence providers

A single provider is a single point of failure and a single point of error. When
it goes dark the board freezes; when it is wrong the board is wrong; and there is
nothing to compare against, so neither is detectable from inside the system.

The answer is not "scrape Wikipedia better". It is to treat every source as
**evidence** and to keep the evidence.

---

## Observe, then project

```
provider ──► RankingObservation ──► reconciler ──► Ranking
             (what a source SAID)   (pure, tier-ordered)   (what we publish)
```

Providers **never** write `Ranking`. They record what they saw, with the source's
own publication date, the URL, the tier and a payload hash. A separate
deterministic pass decides what to publish from **all** the evidence at once.

### What this fixes

`Ranking` is unique per `(division, p4p, fighter, organisation)` — one row. The
old ingest therefore resolved conflicts by **overwriting**:

```ts
if (!shouldWriteRanking(existing?.source, connector.id)) { skipped++; continue; }
await prisma.ranking.upsert({ ... })   // the loser is discarded, unrecorded
```

Three consequences, all of them invisible from the outside:

1. **A conflict could not be detected**, because the losing value never landed.
2. **A published rank could not explain itself.** The row kept `source`, but the
   source's own `effectiveDate` was parsed into `RankingEntry` and then *dropped*
   at persistence — along with the URL and any notion of confidence.
3. **The outcome depended on run order** whenever two providers tied on trust.

---

## The tier order

| Tier | What it is | Confidence |
|---|---|---|
| `OFFICIAL` | Promotion APIs, official ranking releases, official title announcements — the organisation speaking about its own belt | 1.00 |
| `ENCYCLOPAEDIC` | Wikidata, the Wikipedia API, reputable independent media | 0.80 |
| `AGGREGATOR` | Licensed third-party databases (Sherdog / Tapology / BoxRec — **each only if its terms permit**) | 0.65 |
| `INTERNAL` | Our own history and archived snapshots — the floor, so something explainable survives a total provider outage | 0.40 |

**A lower tier can never overwrite a higher one.** But the lower tier is still
*recorded*, which is what makes disagreement visible rather than invisible.

### Recency is a tier-INTERNAL rule

A three-month-old official ranking still outranks a Wikipedia edit from this
morning. The organisation is authoritative about its own list, and Wikipedia
being fresher does not make it right.

Recency only decides between observations **at the same tier** — which is exactly
the case it is good at: "the UFC published a new board".

### Staleness is a floor, not a preference

Evidence older than `MAX_AGE_DAYS` (120) stops deciding anything. Without it, the
last thing a dead provider ever said would be served forever at full confidence.
When nothing usable remains, the reconciler returns **null** — and null is
published as *"no rankings"*, never as a stale value and never as an invented
one.

---

## Lists are decided whole

A ranking is not N independent decisions. Two providers publishing a division
publish an **order**, and mixing them position by position produces a board
neither source ever endorsed — one that can contain the same fighter twice.

So `reconcileList` picks the winning **provider** once and takes its latest
board whole. Other providers still count toward agreement and disagreement (which
is what the admin conflict view reads) but they contribute no rows.

---

## What a published row now carries

| Column | Meaning |
|---|---|
| `source` | The winning provider. Kept, so every existing reader works unchanged. |
| `tier` | Which tier decided it. |
| `effectiveDate` | The **source's** publication date, not our fetch time. |
| `sourceUrl` | Provenance. |
| `confidence` | From the winning tier. |
| `agreementCount` | How many **distinct** providers asserted this. One source publishing twice is not two sources agreeing. |
| `contested` | Another usable provider said something different. |
| `observationIds` | The audit trail — the exact rows behind the number. |
| `reconciledAt` | When the projection last ran. |

---

## Champions

`Champion` is `@@unique([weightClassId, body, current])` — a unique constraint on
a **boolean**. That permits at most **two rows per (division, body) for all
time**: one current, one not.

So the old ingest could not retire a champion into history. It updated the row in
place and reset `since: null, defenses: 0` — **destroying the previous reign's
start date and defence count on every title change**. There was no history, and
no way to add one without removing that constraint.

It was also the *only* writer of champions, driven by a weekly connector run,
while `/api/cron/refresh-champions` ran daily and did nothing at all
(`case "champions": … refresh:noop`). That is the whole of "champions
occasionally outdated".

### TitleReign

One row per reign, accumulating forever:

```
CHAMPION · INTERIM · VACANT · STRIPPED · RETIRED · LINEAL
startedAt · endedAt · defenses · wonAtFightId · lostAtFightId
decidedBy · evidence · contested
```

`VACANT` has no fighter — a fact about the belt rather than about a person, which
the old boolean could not express at all. `STRIPPED` is distinct from losing it
in the ring, and that distinction *is* the record.

The transition rule is what preserves history:

> the open reign disagrees with the evidence → **close** it (`endedAt` = the new
> observation's effective date) → **open** a new one

Closing rather than mutating is the whole point. It ends where the successor
begins, from the **source's** effective date — the belt changed hands when the
body says it did, not when our cron noticed.

`Champion` is still maintained so every existing reader keeps working, but it is
now a **projection** of the open reign. When those readers move to `TitleReign`,
`syncLegacyChampion` is the only thing to delete.

---

## Pound-for-pound

Two P4P systems coexisted, and that is the "P4P sometimes incorrect" symptom:

- the **official** UFC P4P board, parsed and stored under `organisation="UFC"`;
- a **rating engine** computing P4P from `Fighter.wins/losses` for Boxing and
  MMA, stored under `organisation=""`.

**Official always wins.** Where an official list exists it is the published one.

Where none exists, the honest answer is *"No official rankings available."*
The rating engine is retained only as an explicitly-labelled **internal rating**
— it must never be presented as a ranking, because it is our arithmetic, not a
sanctioning body's judgement.

> ⚠️ **Open decision.** Whether to delete the rating engine outright is an owner
> call, because it is a real reduction in coverage: Boxing and MMA would show no
> P4P at all until an official or licensed source is wired. Recorded here rather
> than decided unilaterally.

---

## Incremental by default

A provider's normalized payload is hashed (sorted first, so a source that
reorders its HTML without changing its ranking costs nothing). **Identical hash →
nothing is written at all**: no observations, no projection, no snapshots.

`ProviderCheckpoint` holds `etag`, `lastModified`, `payloadHash`,
`lastCheckedAt`, `lastChangedAt` and a `failureStreak`.

`lastCheckedAt` and `lastChangedAt` are deliberately separate. "Checked an hour
ago" and "changed an hour ago" are different facts, and a freshness dashboard
that conflates them reports a dead provider as healthy.

---

## Licensing

- **BoxRec is blocked in code** (`INGEST_BLOCKLIST`), checked at ingest even if
  the registry were mis-edited to license it.
- Every source carries a `licensed` flag, default **false** — opt-in per source.
- Wikidata is CC0; Wikipedia is CC BY-SA and already attributed.
- Sherdog and Tapology need a commercial decision before either is enabled. The
  `AGGREGATOR` tier exists for them; nothing is wired.
