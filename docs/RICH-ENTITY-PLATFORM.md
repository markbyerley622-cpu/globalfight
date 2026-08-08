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

A full-stack plugin spans three modules, because the pure core, the server query
and the React card have genuinely different constraints:

| Half | Location | Constraint |
|---|---|---|
| Core | `lib/rich-text/plugins/<kind>.ts` | Pure. Imported by `sanitizeEntities`, which runs server-side on every read and inside plain node tests — so no React, no prisma. |
| Loader | `lib/rich-text/preview/<kind>.ts` | `server-only`. Owns the query and what the kind may publish. |
| View | `components/rich-text/previews/<kind>.tsx` | Client. Renders a loaded DTO; never fetches, never handles loading states. |

Each half has a **manifest** (`index.ts`) that imports its files. Registration is
an import side effect, so a plugin left out of a manifest never runs and its kind
is silently unknown. `registry-extensibility.test.ts` fails if a file in any of
the three directories is missing from its manifest.

### Adding a kind — Sponsor, Venue, Judge, Referee, Organisation

Three files and three manifest lines. Nothing else is edited — not `EntityText`,
not the hover host, not the cache, not the composer, not the registry core:

1. `lib/rich-text/plugins/sponsor.ts` — `registerEntity({ kind: "sponsor", … })`
2. `lib/rich-text/preview/sponsor.ts` — `registerPreviewLoader("sponsor", …)`
3. `components/rich-text/previews/sponsor.tsx` — `registerPreview("sponsor", …)`

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
- **Kinds other than `mention` are not yet authorable.** `resolveDraftEntities`
  only resolves mentions, and the composer's picker only offers people. The
  `fighter`, `event`, `gym` and `promotion` plugins are complete — they route,
  preview and cache — but no composer produces those spans yet, so they do not
  appear in production content. Making them authorable is a change to the
  composer and the resolver, not to any of the layers documented above.
- **Event prediction counts** are `null` in the event preview. Picks are counted
  per fight, and summing them for a batch of events is a group-by on a hover
  path. `PreviewStats` drops a null cell rather than printing a misleading zero.
