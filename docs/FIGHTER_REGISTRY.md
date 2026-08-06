# The Fighter Registry

Every fighter exists **once**. Every bout, ranking, title, article, image and
user account points at that one row.

This document is the contract for how that is maintained. The audit that
motivated it is `docs/DATA_AUDIT.md`.

---

## The rule

**Never identify a fighter by their display name.**

A name is not an identifier, and it fails in both directions at once:

- `Alex Volkanovski` and `Alexander Volkanovski` are one person, and a name key
  splits them into two;
- a boxer and an MMA fighter can genuinely share a name, and a name key merges
  them into one.

Before this sprint, **eight of the nine fighter-creation paths** used
`slugify(displayName)` as the primary key of a human being. `fighterSlug()` was
even documented as *"Stable → dedupes by slug"*. So the registry made both
mistakes, constantly, and had no way to notice either.

---

## Resolution order

One function — `resolveOrCreateFighter` in `lib/registry/identity.ts` — and
every ingest path calls it.

| # | Rung | Kind | Acts alone? |
|---|---|---|---|
| 1 | `FighterExternalId (source, externalId)` | identity **claim** | ✅ |
| 2 | `FighterAlias.normalized` | identity claim | ✅ |
| 3 | the deterministic ladder (`entities/resolve`) | **inference** | only if corroborated |
| 4 | corroboration: birthdate, then nationality | fact agreement | — |
| 5 | no confident answer | → review queue | never merges |

### Step 1 is the one that was missing

`FighterExternalId` had **four writers and zero readers**. Sherdog, Tapology and
provider ids were collected on every sync and thrown away, while the same sync
identified people by a name slug. Reading that table is the highest-leverage
change in the whole programme, and it needed no new data — only a query.

The resolver also **links ids on the way through**, so the registry gets more
certain over time instead of re-deriving the same inference forever.

### Step 3 is reused, not reimplemented

`entities/resolve.ts` already held a good ladder: exact-key comparisons from
strongest rung to weakest (`name_exact → alias → nickname → name_loose →
paternal → initial → translit → acronym`), returning **`ambiguous` rather than
guessing** when two candidates tie, with an `OPEN_SET_FLOOR` that refuses the
weak rungs against the whole table. It was pure, tested — and called by nothing.

It is now the middle of the resolver. There is no second matching algorithm.

### Step 4: corroboration, not similarity

There is no fuzzy score to tune. A name match is a *starting point*; what
settles it is agreement on facts that are hard to coincide.

```
birthdate CONFLICT  → NO_MATCH, always. Overrides even an exact name match.
exact identifier    → confident on its own.
inference + birthdate match → promoted to confident.
inference + nationality only → stays POSSIBLE (review).
below the review floor → dropped, not queued.
```

Two rules worth stating because they are easy to get backwards:

- **The birthdate veto outranks everything.** Two people born on different days
  are different people however identical their names. It is the only hard veto,
  and it is what makes the resolver safe to be generous about names elsewhere.
- **Absence is never evidence.** Most imported rows have no birthdate. Reading a
  missing fact as a mismatch would refuse nearly every legitimate match in the
  database.

### Cross-discipline matches

Candidates are deliberately **not** filtered by sport — `Fighter.sports` is an
array because a fighter really can be multi-discipline, and filtering would
guarantee a crossover athlete two rows *and* hide the same-name collision that
most needs a human to look at.

Instead, a **name-only** match that crosses disciplines is demoted to review. An
external id or an agreeing birthdate crosses freely.

---

## Confidence thresholds

```
1.00  external id
0.98  exact canonical name
0.95  registry alias          ── AUTO_LINK_THRESHOLD ── at or above: act
0.90  nickname
0.80  loose name
0.70  dropped surname
0.62  initial + surname       ── REVIEW_FLOOR ── below: drop, do not queue
0.58  transliteration
0.50  acronym
```

Between the two thresholds is the **review band**. Below the floor, a pair is
dropped silently: a queue nobody can finish is a queue nobody reads.

---

## When the resolver is not sure

It does **not** guess and it does **not** silently create a parallel fighter. It:

1. creates the provisional entry, so the ingest is never blocked on a human and
   the data still lands;
2. writes a `FighterIdentityCandidate` linking the two rows, with the comparable
   **facts** attached (`incomingName`, `candidateName`, `birthDate`,
   `countryCode`, `externalIds`) so a reviewer decides from data rather than from
   a number they have no way to interpret.

Merging is a reviewed action. `lib/admin/merge-fighters.ts` already handles the
foreign-key repointing; what was missing was *deciding* what to merge, and that
must never be a confidence threshold applied automatically.

---

## User signup

A fighter signing up is an **identity resolution**, not a row insert.

The old path went straight from "that slug is taken" to `${base}-2` and a
brand-new `Fighter`. So a real fighter got a second identity beside the registry
entry the event pipeline had already built for them — with none of their bouts,
rankings, titles or photos on it. That is the "user-created profiles do not
become canonical registry entries" symptom, exactly.

Now:

| Outcome | What happens |
|---|---|
| `MATCH_CONFIDENT` | The account attaches to the canonical fighter — **only if that row is unowned**. Someone else's verified profile is never reassigned by a signup, however well the names match. |
| `MATCH_POSSIBLE` / `AMBIGUOUS` | Their profile is created **and** the possible match is queued for review. |
| `NO_MATCH` | A provisional registry entry, which is a real registry entry. |

**The registry remains the source of truth. The user account is an identity
attached to it**, not a copy of it.

### On `-2` slugs

A suffixed slug was never itself the bug — two genuinely different people called
Jon Jones need two URLs. The bug was minting one *without ever asking whether
they were the same person*. A suffix is now only reached once identity has
answered "different person", which is also why `persist.ts::planCorner` now
checks for a free slug before creating a corner.

---

## Where identity is enforced

All nine paths:

| Path | Was | Is |
|---|---|---|
| `lib/events/ingest` (highest volume — every corner of every card) | slug upsert | resolver |
| `lib/odds/ingest` | slug upsert | resolver |
| `lib/scraper/ingest` (MMA roster) | slug upsert | resolver |
| `lib/rankings/ingest` | slug lookup | resolver |
| `lib/rankings/curated/ingest` | slug lookup | resolver |
| `services/sync/persist` ×3 | `services/dedupe` | resolver (via a thin adapter) |
| `lib/repo.prisma` (signup) | `-2` duplicate | resolver |

`services/dedupe/fighters.ts` survives only as a signature-compatible adapter so
`persist.ts` compiles unchanged. It contains no matching logic any more.

**One behavioural change worth knowing:** an uncertain match now returns
`fighterId: null` where it previously returned a guess. The caller treats that as
new — which creates a provisional row, with the pair already queued for review.
That is the intended trade: a visible duplicate beats a silent conflation.
