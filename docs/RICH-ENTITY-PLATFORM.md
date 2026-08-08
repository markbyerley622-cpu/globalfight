# The Rich Entity Platform

The single foundation for mentions, previews, navigation and notification of
*things* named inside user-authored text. Forum posts, gym posts, gym comments
and direct messages all run through it.

This document is the durable contract. Keep it current when the architecture
changes.

---

## The model

Text stays human-readable. Identity lives in a parallel entity list that
references rows by **id**:

```json
{ "text": "I think @alex wins.",
  "entities": [{ "type": "mention", "id": "usr_123", "start": 8, "end": 13,
                 "hint": { "username": "alex", "name": "Alex Pereira" } }] }
```

`id` is the truth. `hint` is a rendering convenience that is *allowed* to be
stale — it is refreshed from the database on every read, which is why a rename
or a re-slug applies to all historical content without rewriting a row.

## The four obligations

A surface that stores entities owes four things. Miss any one and the surface
still works, which is precisely why they are asserted by
`lib/rich-text/__tests__/surface-parity.test.ts` rather than left to review.

| Stage | Call | What is lost if skipped |
|---|---|---|
| **write** | `resolveDraftEntities()` | The column is never written; the surface silently stays on the legacy parser forever. |
| **read** | `hydrateEntities()` | Mentions render with the handle frozen at write time; a rename orphans every one of them. |
| **render** | `<EntityText>` | The body prints as a string — no link, no preview, no hover. |
| **notify** | `mentionedUserIds()` | The notifier goes back to guessing from text and can disagree with what was rendered. |

The parity test is driven off `schema.prisma`: it counts `entities Json?`
columns and requires one wired surface per column. Adding a fifth rich-text
table therefore fails the suite until it is wired.

### The one intentional asymmetry

**Direct messages never notify mentions.** A DM is private to its two members.
Telling a third party they were *named* inside one leaks that a private
conversation discussed them, and the notification's link would point into a
thread they cannot open. Mentions in a DM render and link; they never ping.
This is encoded in the parity test as an explicit opt-out carrying its reason.

---

## The registry

`lib/rich-text/registry.ts` holds one **plugin** per kind. A plugin answers
every question anybody can ask about that kind:

```ts
interface EntityPlugin {
  kind: string;                                  // the stored discriminator
  label: string;                                 // a11y / analytics noun
  tone: EntityTone;                              // a palette token, not classes
  href(entity): string | null;                   // deep linking — the ONE definition
  unavailable: string;                           // tooltip when href is null
  previewable: boolean;
  mayPreview?(entity, viewer): boolean;          // client affordance, NOT a control
  analytics?(entity): Record<string, string>;
}
```

**No consumer switches on kind.** `EntityText` asks the registry; so do the
hover hook, the cache and the preview route. This is enforced:
`no-legacy-parsing.test.ts` fails if `EntityText` so much as names a kind.

### Why kinds are validated against the registry

`sanitizeEntities` asks `entityPlugin(type)` rather than checking a literal set.
Registering a plugin is therefore what makes a kind *storable* — there is no
second list to keep in step, and the failure mode of drift (a stored kind the
validator silently drops) cannot occur.

`EntityType` is `string` for the same reason. A union here could never have been
checked against runtime registration; it would only ever have been a second list.

### The three halves of a plugin

A full-stack plugin spans three modules, because the pure core, the server
queries and the React card have genuinely different constraints:

| Half | Location | Constraint |
|---|---|---|
| Core | `lib/rich-text/plugins/<kind>.ts` | Pure. Imported by `sanitizeEntities`, which runs server-side on every read and inside plain node tests — so no React, no prisma. |
| Source | `lib/rich-text/server/<kind>.ts` | `server-only`. Owns every database question about the kind. |
| View | `components/rich-text/previews/<kind>.tsx` | Client. Renders a loaded DTO; never fetches, never handles loading states. |

**The source answers four questions**, and they live together because they
cannot actually be independent — `suggest` hands out the key `resolve` must
accept, and `resolve` writes the hint `hydrate` refreshes:

| Operation | When | Contract |
|---|---|---|
| `suggest` | composer picker | Optional. Bounded, visibility-filtered, ranked best-first. A kind without it is never offered but stays fully storable — gyms and promotions are exactly that today. |
| `resolve` | write | Takes **public keys**, returns ids. One query per batch. |
| `hydrate` | read | Takes ids, returns today's hints. One query per kind per page. |
| `preview` | hover | Takes ids, returns the card DTO. |

Each half has a **manifest** (`index.ts`) that imports its files. Registration is
an import side effect, so a plugin left out of a manifest never runs and its kind
is silently unknown. `registry-extensibility.test.ts` fails if a file in any of
the three directories is missing from its manifest.

### Adding a kind — Sponsor, Venue, Judge, Referee, Organisation

Three files and three manifest lines. Nothing else is edited — not `EntityText`,
not the hover host, not the cache, not the composer, not the registry core:

1. `lib/rich-text/plugins/sponsor.ts` — `registerEntity({ kind: "sponsor", … })`
2. `lib/rich-text/server/sponsor.ts` — `registerEntitySource({ kind: "sponsor", … })`
3. `components/rich-text/previews/sponsor.tsx` — `registerPreview("sponsor", …)`

Implementing `suggest` on the source is the only thing that puts the kind in the
composer's "@" menu. The picker itself is not edited: it renders generic
suggestion fields and takes the group heading from `labelPlural` and the mark
shape from `markShape`.

`registry-extensibility.test.ts` proves this by *doing* it: it registers a
`sponsor` kind that exists nowhere in the source and asserts the pipeline handles
it end to end — validation, segmentation, navigation, preview gating, cache
keying. If that suite ever needs editing to accommodate a new kind, the
architecture has regressed and the edit is the evidence.

A kind with no view falls back to a generic card that names the thing and links
to it. A kind this bundle has never heard of renders as **plain text** — which is
exactly what already happens to legacy content, so a rollout that starts storing
a new kind can never produce a broken-looking body on an older client.

---

## The composer picker

Typing `@` opens one menu offering **People**, **Fighters**, **Events**,
**Gyms** and **Promotions** — whichever kinds' sources implement `suggest`.

```
PEOPLE
  Alex Rodriguez        @alex
FIGHTERS
  Alex Pereira          "Poatan" · MMA · 12-3
EVENTS
  UFC 322               UFC · 15 Nov 2026 · Madison Square Garden
GYMS
  City Kickboxing       Auckland, NZ · MMA · Kickboxing
PROMOTIONS
  UFC
```

**Group order is not configured anywhere.** The server returns one ranked list
across all kinds, interleaved round-robin by rank so no kind can crowd the
others out; the client renders groups in order of **first appearance**. A query
that matches a person best shows People first. No file contains "people before
fighters."

Arrow keys walk the flat ranking, so the highlight never jumps sideways between
groups. `Enter`/`Tab` picks, `Escape` closes (and stops propagating, so it does
not also close the sheet the composer sits in), `Enter` with no menu open falls
through to the surface's own submit. The Composer remains the single keyboard
authority — this added no per-surface handler.

### What gets inserted

`insert` comes from the server and differs by kind, because only one form reads
naturally in a sentence:

| Kind | Key (sent back) | Inserted text |
|---|---|---|
| person | `alex` | `@alex` |
| fighter | `alex-pereira` | `@Alex Pereira` |
| event | `ufc-322` | `@UFC 322` |
| gym | `city-kickboxing` | `@City Kickboxing` |
| promotion | `ufc` | `@UFC` |

Multi-word inserts are why the pick registry no longer scans for a
handle-alphabet token. It scans for the literal string that was inserted, so
`@UFC 322: Main Event` is one span and `@Alex` does not claim `@Alexander`.

**The scan is deliberately permissive.** Searching for `UFC` genuinely matches
inside `@UFC 322` — the character after it is a space, which is not a word
character. That is not a bug: the scanner is handed one pick at a time and asked
where that text appears, so it cannot know which picks were made. Overlaps are
resolved once, later, where the whole set is visible: `build()` sorts by start
then **longer first**, and the sanitiser keeps the earlier span. At the same
offset, "earlier" and "longer" are the same span — the one the author actually
inserted. So `the @UFC put on @UFC 322` stores a promotion and an event, not
three entities.

### Two suggesters with no query between them

`promotion.suggest` touches no database at all — identity lives in the in-code
registry, so it filters a few dozen objects already in memory. It matches
**aliases** as well as names ("ultimate fighting", "onefc") but always inserts
the canonical name, so the stored span does not vary with the alias typed. The
neutral fallback org (`combat` / "Multiple promotions") is declared outside the
`PROMOTIONS` array and is therefore neither suggestable nor resolvable.

Gyms have **no private state to filter**. The `Gym` model has no status, no
soft-delete and no visibility flag; every row is a public page, and `verified`
is a quality signal that orders the directory and gates a gym's own feed — not a
visibility gate. Suggestion and resolution therefore apply the same filter the
rest of the product applies: none. If a visibility concept is ever introduced it
belongs on the model as a shared predicate, the way `PUBLIC_EVENT` works.

---

## Security: the client never holds an id

The single invariant of the write path.

- The picker receives a **key** — a username or a slug, both already public in
  URLs. Primary keys never reach the browser, which is the rule
  `/api/users/search` has always followed and which now holds for every kind.
- `resolve` takes **keys**, not ids. Posting an id back does not resolve.
- The source looks the row up itself, applying its own visibility rules. Draft
  events are excluded by `PUBLIC_EVENT` inside `resolve`, not merely inside
  `suggest` — otherwise picker filtering would be a UI-level control over a
  server-level fact, and anyone who knew a draft's slug could still reference it.
- **The span must be the thing.** The stored text is re-sliced and required to
  equal what the row is actually called. Without it a client could attach any
  entity to a span over somebody else's words, and it would render, link and
  preview. A stale selection — the row was renamed after the menu was drawn —
  fails here too, which is correct: the words no longer say what the entity says.
- Nothing throws. Autocomplete goes stale constantly; every failure degrades the
  span to plain text.

All of this is asserted in `__tests__/draft-resolution.test.ts`, which drives the
real resolver against a fake source — possible only because resolution is
registry-driven rather than a switch.

---

## The shared cache

`lib/rich-text/cache.ts`. One module singleton, not React context — a mention in
the feed and the same person named in a DM panel are the same entity, and a
context would give them separate caches the moment the two live under different
providers. It is also read from raw event handlers that run before any render.

| Guarantee | Mechanism |
|---|---|
| Deduplication | One entry per `kind:id`; five chips for one person share one in-flight request. |
| Batching | A 0ms timer collects everything raised in the same tick into one round trip, capped at 24 to match the route. Overflow defers to the next tick; nothing is dropped. |
| Stale-while-revalidate | A cached answer keeps rendering, flagged `stale`, while a refresh runs behind it. Fresh window: 60s. |
| Cancellation | The last subscriber leaving aborts the request. An abort is not an error — the entry returns to `idle`. |
| Bounded memory | LRU ceiling of 200 entries. Entries with live subscribers are never evicted, so an open card cannot be blanked from under the reader. |
| Negative caching | An id the server does not return is cached `missing` and not retried. |

All of the above is asserted in `__tests__/entity-cache.test.ts`, including the
brief's stated requirement: *hovering five mentions of the same user issues one
request.*

---

## Hover, long-press and focus

One host, mounted once in the root layout. It renders nothing until something is
open, and "only one card is open" is structural — there is one module-level
variable.

| Input | Trigger | Delay |
|---|---|---|
| Desktop | `pointerenter` | 180ms, cancelled immediately on leave |
| Mobile | long press (450ms, 10px slop) | opens at once; the synthetic click is swallowed |
| Keyboard | `focus`, or `ArrowDown` to enter the card | opens at once |

- **Tap still navigates on mobile.** A chip is a link; hijacking the tap to show
  a card is the interaction people complain about most. The preview is the
  deliberate gesture *on top of* the link.
- **Prefetch fires on pointer-enter, before the delay elapses** — so the card
  usually opens with content rather than a spinner.
- **Scrolling suppresses previews** for 220ms. A flick drags the pointer across
  whatever passes under it; without this, a card opens for whichever chip lands
  under a stationary finger. An *already-open* card survives a scroll and
  re-anchors.
- **Not a focus trap.** A hover card is not a modal, and trapping focus in
  something that opens on pointer movement takes the keyboard away from a reader
  who never asked for it. Escape closes and returns focus to the chip; tabbing
  out closes it. `role="tooltip"`, not `dialog` — the card has no focus trap, and
  claiming otherwise misdescribes it to a screen reader.
- **Reduced motion** is honoured via `motion-safe:` on the entrance animation.

Timing constants live in one place (`HOVER_TIMING`) and are pinned by
`hover/__tests__/hover-store.test.ts`, including the 150–250ms band.

---

## Notifications

| Kind | Notifies |
|---|---|
| person | the referenced user — "X mentioned you" |
| fighter | **nobody** |
| event | **nobody** |
| gym | **nobody** — `Gym.ownerId` exists and is never read by any entity source |
| promotion | **nobody** |
| any future kind | **nobody**, by default |

`mentionedUserIds()` filters on kind, and it is the only thing standing between
a fighter mention and a notification. That matters more than it looks:
`Fighter.ownerId` exists, so a claimed fighter page belongs to a real account. A
notifier that read "every entity's id" would eventually ping a real person every
time anyone named them in any post — notification spam with no opt-out.

`entity-notifications.test.ts` pins three things: the filter itself, asserted
against **every registered kind** rather than a hand-written list so a kind added
tomorrow is covered the day it is added; a source-walking guard that fails if any
notifier reads entity ids without going through `mentionedUserIds`; and a guard
that no entity source reads an `ownerId` at all — which is one `.map()` away from
notifying a gym owner every time somebody names their gym.

---

## The search bar

Typing `@alex` into the site-wide search used to return **nothing**: the sigil
went into the query verbatim and no username or display name contains one, so
every family matched zero rows and the overlay said "No results" about a person
who exists.

A leading `@` now strips the sigil and **narrows the search to people** — the
same grammar the composer has used since Phase 4, and the one every product
people already use follows. It is also eight fewer family queries per keystroke.
The rule is a pure function (`lib/search-query.ts`) so it is tested without a
database, and the people query itself is shared with the composer's picker
through `lib/users/search`.

---

## Compatibility layers that remain

Every one of these is deliberate. None is scheduled for deletion on a date; each
has a **condition**.

### 1. The legacy `@handle` parser — `lib/mentions.ts`

**What.** `extractMentions()` and `RICH_TEXT_TOKEN`, the original regex.

**Why it must stay.** Every post, comment and DM written before structured
entities has `entities = NULL`. Re-parsing is the only way to render and notify
that content correctly. There is no backfill and there does not need to be one:
the regex reproduces exactly what those bodies meant when they were written.

**Where it may be called.** Four files, pinned by
`no-legacy-parsing.test.ts`. The bar for a new entry is that it must be the
*fallback branch* of a surface that also reads structured entities, reached only
when there are none.

**When it can go.** When no row in any of the four `entities` columns is NULL —
i.e. after a backfill that resolves historical handles to ids. That backfill is
lossy by nature (a handle written in 2024 may since have been re-registered by a
different person), which is why it has not been done. Deleting the parser without
it silently unlinks and un-notifies all historical mentions.

### 2. `legacy: true` segments — `lib/rich-text/segment.ts`

**What.** A segment produced by the regex path carries `legacy: true` and an
entity with an **empty id**.

**Why.** It can still link (by the handle frozen in the text) but it cannot
survive a rename, and it cannot be previewed — there is no id to look up. The
hover hook checks `entity.id !== ""` for exactly this reason.

**When it can go.** With the parser, above.

### 3. Structured content does *not* also run the regex

Not a compatibility layer but the rule that makes them coexist: when a body
carries entities, they are the **complete** account of what is a mention in it.
Running both would mean a literal `@someone` that nobody picked from the menu
renders highlighted, unlinked and un-notified beside a real mention — the exact
"styled but inert" failure the platform was built to remove.

### 4. `entities: NULL` vs `[]`

Reads normalise an empty result to `null`, so "no entities" has one
representation on the wire and the legacy fallback is reached by the same check
for new content as for old.

### 5. `hint.name` and `publicDisplayName`

`entityDisplayName()` in the registry is the single exemption in
`display-name-usage.test.ts`. It is safe because `hint.name` is *not* a raw
`User.name`: it is stamped through `publicDisplayName` on write and re-stamped on
read. The argument is made once, in one function, rather than at every call site
that needs a name before its preview has loaded.

---

## What is built but not yet wired

Stated plainly so it is not mistaken for working behaviour:

- **`seedEntity()`** — the optimistic path. Implemented and tested, but **no
  surface calls it**. Seeding is only correct when the caller already holds the
  *full* preview shape; a feed row carries an author id, name and image but not
  follower counts or presence, and seeding a partial DTO would render a card
  missing fields it should have. It becomes useful when a surface genuinely
  holds a complete preview.
- All five kinds are now authorable. Nothing in the platform is
  implemented-but-unreachable.
- **Event prediction counts** are `null` in the event preview. Picks are counted
  per fight, and summing them for a batch of events is a group-by on a hover
  path. `PreviewStats` drops a null cell rather than printing a misleading zero.
