# Architecture — media and the social layer

> **Scope.** This document did not exist before the Gym Posts sprint, and it does
> not attempt to describe the whole application (`CLAUDE.md` is the durable
> contract for auth and security; `docs/` holds a file per subsystem). It
> describes one seam in detail: **how user-generated content sits on top of the
> media lifecycle**, because that is the seam every future feature — fighter
> galleries, promotion banners, event posters, article covers — will reuse or
> break.

---

## The one rule

**A post never learns where bytes live.**

Everything below is a consequence of that sentence.

```
   GymPost ──┬── GymPostMedia ────→ MediaAsset ────→ object storage
             │    (the reference)    (the record)     (the bytes)
             ├── GymPostReaction
             └── GymPostComment ─── GymPostCommentReaction
```

Search the entire `GymPost*` schema for `url`, `key`, `bucket`, `filename`,
`mime`, `width`, `height` or `variant` and you will not find one. Those columns
exist exactly once, on `MediaAsset`. The only pointer at storage in the whole
domain is `GymPostMedia.assetId`.

### Why that is worth the extra join

The alternative is what the codebase already had before the lifecycle existed:
`GymPhoto` carries `url`, `thumbUrl`, `width`, `height` of its own. It works,
and it is a table that cannot be scanned, deduplicated, reference-counted or
swept, because the bytes it points at are not tracked anywhere. Every new
feature that copied that shape added another untracked pile of objects.

One `MediaAsset` table means one scanner, one storage layout, one dedupe key,
one cleanup job — and the ability to answer "is anything still using this
file?", which is not a question `GymPhoto` can even express.

---

## Layering

| Layer | Files | Knows about |
|---|---|---|
| **Storage** | `lib/storage`, `lib/images/store` | Buckets, keys, sharp. Nothing above it. |
| **Lifecycle** | `lib/media/asset/*`, `lib/media/scan/*` | Bytes, scan verdicts, states, reference counts. **Not gyms, not posts.** |
| **Domain** | `lib/gym-posts/*` | Posts, comments, permissions, ranking. Holds `assetId` and calls `retainMedia`/`releaseMedia`. |
| **Transport** | `app/api/gym/posts/*`, `app/api/media` | HTTP. Authenticate, parse, rate-limit, call. **No policy.** |
| **UI** | `components/gym-posts/*` | Rendering. Receives URLs and permission booleans; derives neither. |

Each layer may call downward and never upward. `lib/media` importing anything
from `lib/gym-posts` would be the first sign the separation has been lost.

### Why `MediaAsset` stays storage-agnostic

`MediaAsset.ownerId` is **who uploaded it**, not what it belongs to.
`MediaAsset.sourceType` (`"gym-post"`, `"fighter-photo"`) is a **cleanup and
analytics tag and explicitly not an authorization input** — it arrives from a
client, and a string on a row must never become a capability.

Attachment lives on the consumer's side (`GymPostMedia`), which is what keeps
the asset generic. When fighter galleries arrive they add `FighterPhotoMedia`
and one back-relation line; they do not touch `MediaAsset`'s columns and they do
not get a second upload pipeline.

---

## Reference counting

**A `GymPostMedia` row *is* a reference.** Creating one takes a reference;
deleting one releases it. There is no other way for this domain to move
`refCount`.

### How reference counting prevents premature deletion

Deduplication is keyed on the SHA-256 of the original bytes, so two members who
upload the same gym flyer are handed **the same asset row**. Without counting,
whichever of them deleted their post first would take the image out of the
other's post. With counting, that row sits at `refCount = 2`, the first delete
brings it to 1, and the sweep — which only collects at zero — leaves it alone.

There is an integration test that asserts exactly this, because it is the
invariant the whole mechanism exists for.

### Ordering, and which way it is allowed to fail

`refCount` lives on a different table, owned by `lib/media`, so the two writes
are not in one transaction. The **order** therefore decides what a crash between
them costs:

| Operation | Order | Crash in between |
|---|---|---|
| attach | `retainMedia` → insert row | **over**-counted: asset never collected (costs storage) |
| detach | delete row → `releaseMedia` | **over**-counted: asset never collected (costs storage) |

Both fail toward over-counting. Under-counting would let the sweep collect an
asset a live post still points at — the reader gets a broken image and the
author loses their photo. That is the same conservative direction `cleanupMedia`
already chose when it decided to mark rows rather than delete bytes.

### An upload is not a consumer

`ingestMedia` sets `refCount = 1` on a new asset. If that reference survived,
every abandoned composer draft would pin its uploads at one reference forever
and the sweep — which collects at zero — could never reclaim them.

So `POST /api/media` **releases that reference before returning**. An
uploaded-but-unattached asset sits at zero and is swept once it is older than
the six-hour grace period: long enough to write a post, short enough that
abandoned drafts do not accumulate.

### How cleanup interacts with post deletion

Deleting a post is a **soft delete** (`deletedAt`) plus a **hard detach**:

1. `updateMany … where deletedAt: null` — an **atomic claim**. Exactly one
   caller wins the transition, so two simultaneous deletes cannot both go on to
   release the same references and drive a shared asset below what other posts
   still hold. A check-then-write here would be a silent double-release, which
   is the one failure mode that destroys another post's images.
2. The `GymPostMedia` rows are **deleted** and one reference released each.

The post's words survive for an appeal; the images are released. The asset row
survives too — the sweep only sets `status = DELETED`, and byte removal is still
a separate, unimplemented step — so material under moderation review is not
destroyed by the sweep either.

Moderator **restore** returns the words and deliberately **does not re-attach
the media**: those references were released, the assets may already have been
swept, and silently re-pointing at them would resurrect either nothing or
somebody else's bytes.

---

## Authorization

**Answered from the post, never from the media.**

`lib/gym-posts/visibility.ts` is pure — no database, no request, no session —
and holds the entire decision table. `lib/gym-posts/authorise.ts` answers only
the three *factual* questions it needs (staff? member? gym owner?) from the
database.

The rule that matters: **permission is never derived from `MediaAsset`.** Assets
are deduplicated, so `ownerId` records whoever uploaded a given file *first*.
Deriving any right from it would hand the first uploader of a common image power
over every later post that attaches it. The asset is storage. Permission is
domain. They never meet — and there is a structural test asserting `PostSubject`
carries no field describing media.

| | read | edit | delete |
|---|---|---|---|
| author | ✓ | **✓ (only)** | ✓ |
| gym owner | ✓ | ✗ | ✓ |
| moderator / admin | ✓ | ✗ | ✓ |
| member | per visibility | ✗ | ✗ |

Only the author may **edit**. An owner or moderator may **delete** — removal is
a moderation act with an audit trail; editing would be putting words in another
person's mouth under their name and face. Collapsing the two into one
`canModerate` boolean is how that happens by accident.

**Publishing** has two independent gates: the gym's **verification state**
(`gymCapabilities(state).publishPosts` — an unclaimed or under-review gym
publishes nothing, from anybody) *and* membership. Routing member posts around
the first would have quietly undone the gym-verification work it was built for.

---

## The feed

### Ranking

`lib/gym-posts/ranking.ts`, pure and deterministic. No randomness, no jitter, no
personalisation-by-embedding — same inputs, same order, always. A feed that
reorders itself between two renders of the same data loses the reader's scroll
position and cannot be debugged.

```
score = (1 + engagement + media + reputation) / (ageHours + 2) ^ 1.5

engagement = 1·log(reactions) + 2.5·log(comments) + 4·log(shares)
media      = 1.2 if any, +0.8 if wide enough to fill a card
reputation = 0.2·log(reputation)
```

Three deliberate choices:

- **The leading `1`.** Without it a brand-new post with no engagement scores
  zero and can never surface — the bootstrap problem that makes a new gym's feed
  look abandoned however much they post.
- **Log compression.** The step from 3 comments to 6 is worth more than 300 to
  306, which matches how much those two facts actually tell you, and stops an
  old hit sitting on top of everything new.
- **Reputation at 0.2.** The *entire* spread from a new account to the
  highest-reputation member on the platform is worth less than two comments.
  Asserted in the tests. Reputation breaks ties; it cannot manufacture reach.

Then **duplicate suppression** (same normalised text + same sorted asset set)
and **diversity** (no two consecutive posts from one gym while an alternative
exists — reordering only, never dropping).

### Pagination, and the honest limit of the ranking

Page **boundaries** are keyset `(createdAt, id)`; **ranking happens within the
page**. No `OFFSET` anywhere.

Offset paging on a list that grows at the head shows the reader the same post
twice and silently hides another, and gets slower the further they scroll.
Keyset is stable under writes and costs the same on page 300 as on page 1.

The consequence, stated plainly: **a post cannot climb from deep in the archive
to the top of page one on score alone.** Ranking a wider candidate window and
returning the best N would have to *discard* the rest, and a discarded post is
one nobody ever sees. So nothing is dropped, nothing repeats, and the ranker
does what it can usefully do at this scale — break up runs from one gym, and
lift the posts people engaged with to the top of the screen the reader is on.

**Upgrade path when this stops being enough:** materialise the score in a
`GymPost.rankScore` column and recompute it on a schedule (freshness decays
whether or not anything is written, so it cannot be computed on write alone).
Then the keyset moves to `(rankScore, id)` and ranking becomes global. That
trade — a cron plus write amplification — is not yet earned.

### Query budget

Constant in queries regardless of page size. Nothing loops a query over rows.

| Read | Queries |
|---|---|
| feed page | 5 (viewer scope ×2, posts+media+author+gym, reaction tallies, viewer's own reactions) |
| comment page | 3 |

The two viewer-scope reads are what let the visibility filter run **in SQL**
rather than loading rows the caller may not see and discarding them in JS —
which would make `take` a lie and the page short. The pure predicate is then
re-applied to every row that comes back: the SQL filter is an optimisation, the
predicate is the control.

---

## What was reused rather than rebuilt

Listed because "did you build a second one of these?" is the question to ask of
this sprint:

| Concern | Reused |
|---|---|
| Upload validation | `lib/images/upload-policy` (size, type, magic bytes) |
| Scan / process / publish | `lib/media/asset/lifecycle` |
| Storage | `lib/images/store` behind `MediaProcessor` |
| Text moderation | `lib/moderation/text` (`assertPublishable`) |
| Reports queue | `ForumReport` + `/api/forums/report` + the admin console, widened to `gym_post` |
| Notifications | `notify()` / `notifyMany()`, plus three `NotificationType` values and three lines in `push/policy` |
| Rate limiting | `lib/rate-limit` `POLICY` |
| Gym permissions | `gymVerificationState` / `gymCapabilities` (the same pure functions `authoriseGymCapability` calls) |
| Report dialog UI | `components/forums/report-dialog` |
| Scroll restoration | `components/layout/scroll-restoration` (the feed restores its *pages* so that loop has a container to converge on) |

New: the `GymPost*` tables, `lib/gym-posts/*`, `components/gym-posts/*`, and
`POST /api/media` — which is not a second pipeline but the first **door** to the
existing one. `ingestMedia` had no HTTP entry point and no caller before it.
