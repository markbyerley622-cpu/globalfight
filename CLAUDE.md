# GlobalFight — engineering guide

Combat-sports platform (Next.js 15 App Router, Prisma/Postgres, stateless JWT
auth). This file is the durable contract for how the app is built and secured.
Keep it current when the security model changes.

- Build/verify: `npm run typecheck` · `npm run lint` · `npm run build` ·
  `npm test` (172 unit) · `npm run security:audit` (query-ownership auditor,
  must stay **0 HIGH**).
- E2E: `npm run build` then `next start`, point `BASE_URL` at it, `npx playwright
  test`. **Never sign off UI from `npm run dev`** — HMR emits phantom
  `Invalid or unexpected token` / soft-500s that do not occur in a production
  build.
- Schema deploy: no migration history in the live deploy — the build runs
  `prisma db push`. A **missed push shows as an empty page, not an error**, so a
  schema change must ship with its push.

# Access control

## Principals

| Principal | How it's carried | Notes |
|---|---|---|
| **Anonymous** | no cookie | Public reads only. Every mutation → **401**. |
| **User** (`role=USER`) | `cr_session` JWT (httpOnly, `sameSite=lax`, `secure` in prod) | The default. Owns its own rows only. |
| **Moderator** (`role=MODERATOR`) | same | User + forum/content moderation (edit/delete any post). |
| **Admin** (`role=ADMIN`) | same | Moderator + `/admin/*` and admin APIs. |
| **Cron** | `SCRAPE_CRON_SECRET` bearer | Machine principal for `/api/cron/*`. No user identity. |

`registryRole` (fan/fighter/coach/gym/promoter/…) is a **self-declared label
with no privilege** — it drives UI and "claim your page" nudges only. Never gate
an authorization decision on `registryRole`; gate on `role` via
`isAdminRole()` (`src/lib/admin/guard.ts` — the ONE definition).

Session epoch: every JWT carries `tv` (`User.tokenVersion`). Bumping
`tokenVersion` (password change/reset, sign-out-everywhere) revokes all
outstanding sessions at once. A tampered or stale-epoch token resolves to
**anonymous**, never to a partial identity.

## The matrix

Verified empirically against a production build (red-team pass, 2026-07-26).
"Owner" = the row's `userId`/`authorId`/`followerId`.

| Resource | Anonymous | User (non-owner) | User (owner) | Moderator | Admin |
|---|---|---|---|---|---|
| Public content (fighters, events, fights, rankings, gyms, gym reviews, forum threads/posts) | **read** | read | read | read | read |
| Prediction Victory Card (`/u/<user>/call/<fight>`) | **read** (public boast, share target) | read | read | read | read |
| `FightPick` (own picks) | ✗ (401) | ✗ own-scoped | CRUD own | — | — |
| Crowd pick tally | read (aggregate) | read | read | read | read |
| `GymReview` write | ✗ (401) | ✗ | **1 per gym**, edit/delete own | delete any (moderation) | delete any |
| `GymPost` read | **read** (PUBLIC only) | PUBLIC + MEMBERS of gyms they've joined | + own PRIVATE | all live | all live |
| `GymPost` write | ✗ (401) | ✗ (**403** — must be a member of a **verified** gym) | create; **edit own only**; delete own | delete any (**not** edit) | delete any |
| `MediaAsset` | ✗ (401) | upload own | upload own; attach any **READY** asset | — | — |
| `ForumPost` edit/delete | ✗ (401) | ✗ (**403**) | own only | **any** | any |
| Profile (`PATCH /api/profile`) | ✗ (401) | ✗ | own; **cannot** set `role`/`reputation`/pick stats | own | own |
| Follows / favourites / bookmarks | ✗ (401) | ✗ | CRUD own | own | own |
| `Notification` | ✗ (401) | ✗ own-scoped | read/mark own | own | own |
| `CheckIn` (location) | ✗ (401) | ✗ | CRUD own | own | own |
| `Conversation` / `DirectMessage` (DMs) | ✗ (401) | ✗ (**404**, no existence oracle) | read/send as a member | — | — |
| DM typing signal (`POST /api/messages/<id>/typing`) | ✗ (401) | ✗ (**204**, silent no-op) | set own; reads the other member's via the thread GET | — | — |
| Fighter/Gym **claim** evidence (identity docs) | ✗ (404) | ✗ (404, no IDOR oracle) | claimant reads own | reviewer reads | reviewer reads |
| Gym roster roles | — | ✗ | — | — | promote/demote; **owner demotable only via admin claim resolution** |
| `/api/admin/*` | ✗ | ✗ (**403** API / **404** page) | ✗ | subset | full |
| `/api/cron/*` | ✗ (**401**) | ✗ | ✗ | ✗ | ✗ (needs cron secret, not a user) |
| Account delete / password | ✗ (401) | ✗ | own only | own | own |

## Enforcement rules (how the matrix is actually held)

1. **Every mutation authenticates first.** `getCurrentUser()` → 401 before any
   work. Verified: all write endpoints return 401 anonymous.
2. **Ownership is checked in the service layer**, not the route, so it holds for
   every caller of the function. Pattern: `if (row.authorId !== userId &&
   !isAdmin) throw`. Verified USER-vs-USER: forum edit/delete → 403.
3. **Sensitive columns are allow-listed, never mass-assigned.** Signup/profile
   ignore injected `role`, `reputation`, `picksCorrect`. Verified: injection
   left all three unchanged.
4. **Concurrency-safe writes** use `upsert` / `createMany(skipDuplicates)` /
   `updateMany` guards, never check-then-`create` (which races the unique
   constraint into a P2002 that both fails the write AND leaks the constraint
   name to the client). Verified: 60 concurrent picks → 1 row; 100 concurrent
   follows → 1 row; 8 concurrent gym reviews → 1 row, no leak.
5. **Never return a raw Prisma error to the client.** A P2002/P2025 message
   names models and columns. Throw a user-facing `Error` with your own text, or
   return a generic 400. (Service functions here throw human strings on purpose;
   the routes pass `err.message` through — that is only safe because the ORM
   errors are prevented at the source per rule 4.)
6. **Uniform 404 for unauthorized access to private-by-id resources** (claim
   evidence): anonymous and non-owner both get 404, so the endpoint is not an
   existence oracle. The DM **typing** endpoint is the same rule with a
   different code: it answers **204 always**, whether or not the conversation
   exists and whether or not the caller is in it, because the write underneath
   is a membership-scoped `updateMany` that is simply a no-op for a non-member.
   A 404 there would confirm which conversation ids are real.
7. **Outbound fetch from user input is IP-validated, not just host-validated.**
   `/api/img` resolves the hostname and rejects any private/loopback/link-local
   address on every redirect hop (`isBlockedAddress`) — a string check alone
   lets `x.nip.io`-style names that *resolve* private through (SSRF).
8. **CSRF**: state-changing endpoints are JSON POST/PATCH/DELETE behind a
   `sameSite=lax` httpOnly cookie; cross-site form posts don't carry it. Keep new
   mutations non-GET and JSON-only.

When you add a write endpoint, walk rules 1–8. When you add a table, place it in
the RLS classification below.

# Row-Level Security (defense-in-depth)

**Active control today = application-layer:** every private read is owner-scoped
(`where: { userId }`). The query-ownership auditor (`npm run security:audit`)
greps for private-table reads missing that filter and must stay **0 HIGH**.

**RLS is the second layer** — it catches the day a query forgets the filter, and
blocks even an explicit cross-user `WHERE userId = <someone-else>`. It is
**staged, not yet applied** (see `docs/SECURITY-RLS.md`), because the app
connects as the table **owner**: applying `FORCE ROW LEVEL SECURITY` without the
per-request `app.user_id` wired would blank every private read — an outage.

Artifacts, ready to activate:
- `prisma/rls/policies.sql` — the policies (Group A owner-only; Group C public
  read-permissive guard rails).
- `src/lib/db-rls.ts` — `withUser()` session-context wrapper, gated behind
  `RLS_SESSION_CONTEXT=1`, inert until then. Sets `app.user_id` with a **bound
  parameter** (`set_config($1,$2,true)`), never string interpolation.
- `prisma/rls/verify.sql` — post-apply assertions (run as the non-owner role).

Proven in an isolated sandbox during the red-team pass: as userA only userA's
rows are visible; anonymous sees zero private rows but public tables still
render; `userA … WHERE userId='userB'` returns **0**.

### Table classification (which layer applies)

- **Group A — owner-only read+write (RLS `USING (userId = app.user_id)`):**
  `Notification`, `FightPick`, `Session`, `Account`, `PushSubscription`,
  `CheckIn`, `ForumBookmark`, `ForumSubscription`, `ConversationMember`,
  `Conversation`/`DirectMessage` (scoped via membership, not a `userId` column —
  a DM is shared between two people, so ownership is "is a member of", and that
  check lives in `lib/messages/repo`; `ConversationMember.typingAt` is presence
  on that same row and inherits the same scoping — it is written only by a
  membership-scoped `updateMany` and read only through `getConversation`),
  `FavoriteFighter/Promotion/Event`, `UserFollow` (by `followerId`),
  `AnalyticsEvent`. `PasswordResetToken`: RLS on, **no** policy (server-only, by
  hash).
- **Group B — public read, owner-only write (app-layer + rate limit):**
  `ForumThread`, `ForumPost`, `GymReview`, `GymReviewVote`, `Gym`, `Article`,
  `CommunityVote`, `Battle`, `Rivalry`,
  `GymPost`, `GymPostMedia`, `GymPostComment`, `GymPostReaction`,
  `GymPostCommentReaction`.
  ⚠️ `GymPost` is the first Group B table with **per-row** visibility: a
  `MEMBERS` or `PRIVATE` post is not world-readable. The app-layer control still
  holds in the usual way — every read goes through `getFeed`/`getPost`, which
  apply the visibility filter in SQL *and* re-apply the pure predicate
  (`lib/gym-posts/visibility`) to each row. But an eventual RLS policy for this
  table cannot be a plain owner match: it needs the `visibility` column plus a
  `GymMember` lookup. Noted here so that is discovered at design time rather
  than at apply time.
- **Media:** `MediaAsset` is Group A-adjacent — `ownerId` is *who uploaded it*,
  never who may see it, and it is deduplicated so that column records whoever
  arrived first. **No authorization decision anywhere may read it.** Servability
  is `status === READY`; permission belongs to whichever consumer holds the
  reference.
- **Group C — fully public (RLS optional, permissive `SELECT true` guard rail):**
  `Fighter`, `Event`, `Fight`, `Ranking`, `WeightClass`, `Promotion`, …

Activation order (all in staging first): non-owner `app_rw` role → ship
`RLS_SESSION_CONTEXT=1` → apply `policies.sql` → `verify.sql` + full test suite →
production off-peak with `DISABLE ROW LEVEL SECURITY` as tested rollback.
