# API

> **Scope.** Started with the Gym Posts sprint. It documents the media and gym
> post endpoints; the rest of `/api` is not yet covered here. `CLAUDE.md` holds
> the access-control matrix that every endpoint below obeys.

**Conventions across all of these.**

- JSON only, and every mutation is `POST`/`PATCH`/`DELETE`. That is the CSRF
  control: the session cookie is `sameSite=lax` and httpOnly, so a cross-site
  form post does not carry it (CLAUDE.md rule 8).
- `401` = not signed in. `403` = signed in and refused. `404` = does not exist
  **or** the caller has no business knowing it does — the two are deliberately
  indistinguishable for anything not publicly visible (rule 6).
- `429` carries `retry-after`.
- Errors are `{ "error": "<a sentence for a human>" }`. Never a raw ORM message
  (rule 5).
- Viewer-dependent reads send `cache-control: private, no-store`. The same URL
  yields different posts per viewer, so a shared cache would serve one member's
  members-only feed to everybody.

---

## `POST /api/media`

The **one door** to the media lifecycle. Multipart, not JSON.

Auth required. Gated by `UGC_MEDIA_UPLOADS_ENABLED` — while that is off this
returns **503** and nothing else about the request matters (fail-closed by
design).

| Field | |
|---|---|
| `file` | The image. JPEG / PNG / WebP / AVIF, ≤ 8 MB. Validated by **magic bytes**, never by the declared `Content-Type`. |
| `sourceType` | Optional tag for cleanup and analytics (default `"gym-post"`). **Never an authorization input.** |

**201**

```json
{ "ok": true, "assetId": "clx…", "deduped": false,
  "media": { "id": "clx…", "url": "https://…/full.webp",
             "thumbUrl": "https://…/thumb.webp",
             "width": 1600, "height": 1200,
             "alt": null, "caption": null, "blurhash": null } }
```

`deduped: true` means these exact bytes already existed; the same `assetId` is
returned and nothing was re-scanned, re-processed or re-stored.

| Status | Meaning |
|---|---|
| `413` / `415` | Too big, or not an image we accept. |
| **`422`** | **Refused.** The scanner called it infected, or it failed validation. The response deliberately **does not say which** — a precise refusal is a free oracle for tuning a payload until it passes. |
| **`503`** | **Ours, not yours.** The scanner was unreachable or storage is unconfigured. `REJECTED` and `FAILED` are different states for exactly this reason: one is a blocked attack, the other is an outage. |

**The response contains no key, no bucket and no signed URL** — only an id and
the URLs already published for the variants.

**The returned asset holds no reference.** An upload is not a consumer; only an
attachment is. Uploaded and never attached, it is swept after six hours. See
`docs/ARCHITECTURE.md`.

Rate limit: 40/hour per account, 80/hour per IP.

---

## `GET /api/gym/posts`

The feed. Public.

| Query | |
|---|---|
| `gym` | Gym slug. Omitted = the cross-gym feed. |
| `cursor` | Opaque. Feed back verbatim; **never parse it.** A malformed one starts from the beginning rather than erroring. |
| `limit` | Default 20, hard max 50. |

```json
{ "items": [ /* GymPostDTO */ ], "nextCursor": "eyJ…" | null }
```

Anonymous callers see `PUBLIC` posts only. A signed-in caller additionally sees
the `MEMBERS` posts of gyms they belong to and their own `PRIVATE` ones. That is
decided in the service layer, not by the caller.

Ordering is **deterministic**: keyset by recency for the page boundary, ranked
within the page. `nextCursor: null` means the end.

### `GymPostDTO`

```jsonc
{
  "id": "clx…",
  "gym":    { "id", "slug", "name", "logoUrl", "verified" },
  "author": { "id", "name", "username", "image", "registryRole" },
  "body": "Open mat Saturday, 11am.",
  "visibility": "PUBLIC" | "MEMBERS" | "PRIVATE",
  "pinned": false,
  "media": [ { "id", "url", "thumbUrl", "width", "height", "alt", "caption", "blurhash" } ],
  "commentCount": 4, "reactionCount": 12, "shareCount": 1,
  "reactions": { "like": 9, "fire": 3 },
  "myReactions": ["like"],
  "createdAt": "2026-08-06T…", "editedAt": null,
  "canEdit": true, "canDelete": true
}
```

`canEdit` / `canDelete` are resolved **server-side**. Clients render from them
and never re-derive permission from the ids they hold.

`author.name` is the **public display name**, never `User.name` raw — people
type email addresses into that field.

Note what `media[]` does not contain: no `assetId`, no key, no bucket, no
filename.

---

## `POST /api/gym/posts`

Publish. Auth required.

```json
{ "gym": "iron-house", "body": "…",
  "visibility": "PUBLIC",
  "media": [ { "assetId": "clx…", "alt": "…", "caption": "…" } ] }
```

`media` accepts bare id strings too. Max 10; duplicates within one post collapse
to one row and **one** reference.

**201** → `{ "ok": true, "post": GymPostDTO }`

| Status | Meaning |
|---|---|
| `400` | No text and no media; body failed moderation; an attachment is not `READY`. |
| **`403`** | The gym is not verified (its feed is closed to everybody), **or** you are not a member of it. |
| `404` | No such gym. |

Rate limit: 20/hour per account.

---

## `GET` / `PATCH` / `DELETE /api/gym/posts/{id}`

**GET** — public. `404` when it does not exist *or* is not visible to you.

**PATCH** — **author only** (`403` otherwise).

```json
{ "body": "…", "visibility": "MEMBERS",
  "media": [ { "assetId": "clx…" } ] }
```

Every field optional. `media` is the **desired final set**, not add/remove verbs
— the diff is computed server-side, so replaying the same PATCH is a no-op on
the reference counts. Omitting the key leaves media untouched; `[]` removes all
of it. Sets `editedAt` (distinct from `updatedAt`, which moves whenever a
counter does).

**DELETE** — author, the gym's owner, or staff. Soft delete: the row and the
words survive for an appeal, the media references are released, and the post
disappears from every read path including for its author.

---

## `GET` / `POST` / `PATCH` / `DELETE /api/gym/posts/{id}/comments`

**GET** — `?cursor=&limit=` (default 20, max 100). **Oldest first** — a
conversation reads top to bottom.

**POST** — auth required. `{ "body": "…", "parentId": "clx…" | null }` → **201**
`{ "ok": true, "comment": GymPostCommentDTO }`.

One level of nesting: replying to a reply attaches to its parent, so the thread
stays two levels deep however deep the UI lets someone click. A `parentId` from
a different post is silently flattened rather than rejected — rejecting it would
tell the caller whether an id they guessed exists.

**PATCH** — `{ "commentId": "…", "body": "…" }`. Author only.
**DELETE** — `?commentId=…`. Author, gym owner, or staff. Soft delete; the
comment renders as a tombstone so its replies still answer something.

A removed comment returns `deleted: true` and an empty `body`.

Rate limit: 40 / 15 min per account.

---

## `POST /api/gym/posts/{id}/reactions`

Toggle. Auth required. One endpoint for posts and comments.

```json
{ "type": "like" | "fire" | "respect" | "laugh", "commentId": "clx…" }
```

`commentId` optional — present reacts to that comment, absent reacts to the
post. An unrecognised `type` falls back to `like` rather than erroring: a newer
client should register *something*.

```json
{ "ok": true, "reacted": true, "reactionCount": 13,
  "reactions": { "like": 10, "fire": 3 }, "myReactions": ["like"] }
```

Counts are **recomputed**, not incremented — they feed the ranker, so drift
would silently distort what the feed promotes. Concurrent taps settle at one row
and no caller sees an error.

Rate limit: the shared `interaction` ceiling, 150 / 5 min.

---

## `POST /api/gym/posts/{id}/share`

Record a share. **Anonymous is allowed** — sharing should not require an
account, and requiring one would mean the count only ever measures signed-in
sharers.

`{ "ok": true, "shareCount": 4 }`

**`PUBLIC` posts only** (`403` otherwise). Handing out a share link to a
members-only post would be an invitation to leak it, and the count would
advertise that something private exists.

This is the most tightly bounded write in the domain: `shareCount` is the
heaviest input to the ranker, so an unbounded anonymous increment is a one-line
script for putting any post at the top of the feed. **10/hour per IP per post.**

---

## `POST /api/forums/report`

Unchanged endpoint, widened `targetType`.

```json
{ "targetType": "thread" | "post" | "gym_post",
  "targetId": "clx…", "reason": "spam", "detail": "…" }
```

Gym posts join the **existing** moderation queue — same `ForumReport` table,
same console, same audit trail — rather than getting a second one. Hiding a gym
post from the console goes through the service layer, so its media references
are released rather than pinned forever.

Rate limit: 20/hour per account.
