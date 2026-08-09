# RLS table classification — evidence pack

**Status:** classification only. **No RLS was activated, no role provisioned, no
policy applied, no production state changed.**

**Scope:** the 29 security-relevant tables absent from CLAUDE.md's RLS
classification, agreed with the owner after the count was corrected (see
"Scope correction"). The remaining 33 unclassified tables are covered by one
bulk justification at the end.

Evidence classes used throughout: **PROD** (verified over HTTP against the
deployed app) · **CODE** (traced in source) · **UNVERIFIED** (stated, with the
exact check needed).

---

## Scope correction — the count was wrong

The previous session reported **13** missing tables. The real number is **62 of
101**. The 13 was an artefact of my own method: I intersected unclassified models
with a regex over a narrow set of ownership columns. That heuristic is
structurally blind to the tables that matter most.

| Missed by the heuristic | Why |
|---|---|
| **`IdentityDocument`** | **No person column at all** — scoped via `verificationId` to its parent. The most sensitive table in the product. |
| `ForumReport` | `reporterId` |
| `GymPhoto` | `uploadedById` |
| `AuditLog` | `actorId` |
| `Feed*`, `ArticleView` | per-viewer via a `key` column |
| **`User`** | It *is* the user — no `userId` column. The root of every ownership chain. |

**The lesson for the rollout:** never derive the RLS scope from column names.
Derive it from access paths. A table can be user-owned with no user column
(`IdentityDocument`), and a table can have a `userId` and still be public
(`GymReview`).

Corrected breakdown of the 62:

```
22  person-owned            (IdentityVerification, AuditLog, 3 claim tables, …)
 1  person-owned via parent (IdentityDocument)
 6  per-viewer via `key`    (Feed*, ArticleView)
33  system / reference / scraper
```

`DataSource` was a false positive in my `key` bucket — its `key` is a source
identifier, not a person. Recorded so the error is not inherited.

---

## FINDING H-2 · Anonymous cross-user read **and write** of feed state — OPEN

*Class: PROD + CODE.* Found while classifying the `Feed*` tables. This is a live
exploitable path, not a theoretical one, and it is the exact shape the RLS work
exists to prevent: **change an identifier, get another person's data.**

**The mechanism, in three composable facts.**

1. **CODE** — `src/lib/feed/identity.ts`:
   ```ts
   export async function feedKey(fallbackCid: string): Promise<string> {
     const uid = await getSessionUserId();
     return uid ?? fallbackCid;   // ← anonymous callers choose their own key
   }
   ```
   For a signed-in caller the session wins, so a logged-in user cannot
   impersonate another. For an **anonymous** caller, `cid` from the query string
   or request body becomes the row key verbatim
   (`src/app/api/feed/library/route.ts`, `feed/prefs/route.ts`,
   `feed/library/collection/route.ts`).

2. **PROD** — unauthenticated, with a synthetic key:
   ```
   GET  /api/feed/library?cid=some-other-users-id   → 200, returns that key's collections
   POST /api/feed/prefs   {"cid":"some-other-users-id", …} → 200 {"ok":true}
   ```
   Read *and* write against a caller-chosen identity, with no session.

3. **PROD** — `User.id` is **published**. `/leaderboard` serves cuid values in its
   RSC payload directly beside the username
   (`"cmsaaddgt…", {"href":"/u/king"}`). The keyspace is not secret.

**Impact.** An unauthenticated attacker who reads an id off the public
leaderboard can read a named user's saved video library (`FeedCollection`,
`FeedCollectionItem`) and write their personalisation state — hide channels,
mark videos not-interested, skew interest weights (`FeedHiddenChannel`,
`FeedNotInterested`, `FeedInterest`, `FeedView`). It is not messages or
documents, so this is **HIGH, not CRITICAL** — but it is unauthenticated,
read-write, and targeted at a named person.

**Not proven:** I did **not** execute the read or write against a real user's id.
I attempted it, it was correctly blocked as a destructive production action, and
I did not retry. The chain above is established from the code plus synthetic-key
probes; confirming it against a real account would require the owner's
authorisation and should be done on staging.

**Why RLS alone will not fix this.** A policy of
`USING (key = current_setting('app.user_id'))` would deny anonymous access
entirely and break legitimate anonymous personalisation, which is a product
feature. The fix belongs in the application first: stop honouring a
client-supplied identity. Options, in order of preference:

1. Derive the anonymous key from a **server-set httpOnly cookie**, never from a
   query/body parameter.
2. Namespace it so a client key can never collide with a `User.id`
   (e.g. store `anon:<cid>` and `user:<uid>`), which closes the impersonation
   even if a raw `cid` is still accepted.

Then RLS becomes expressible: `key = current_setting('app.user_id')` for the
`user:` namespace, permissive for `anon:`.

**Recommended before RLS activation, because RLS cannot express the current
mixed namespace safely.**

---

## Classification matrix

Legend — **A** owner-only · **B** membership-scoped · **C** public row with
private columns · **D** server-only / no application-user policy.

| Model | Class | Row owner | Anon | USER (self) | Other USER | MOD | ADMIN | Service | Current protection | Required RLS boundary | Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **User** | C | self (`id`) | read public cols | read+write own | read public cols | read | read all | rw | Service layer; `SAFE_SELECT` allow-list in `lib/auth` | `id = app.user_id` for write; SELECT permissive — **RLS cannot protect columns** | **CRITICAL** |
| **IdentityVerification** | A | `userId` | ✗ | read own | ✗ 404 | ✗ | read all | rw | `lib/identity-verification`, uniform 404 | `userId = app.user_id` OR staff | **CRITICAL** |
| **IdentityDocument** | A (via parent) | `verification.userId` | ✗ | read own | ✗ 404 | ✗ | read all | rw | Owner-or-staff reader, uniform 404, audited | `EXISTS(verification WHERE userId = app.user_id)` OR staff | **CRITICAL** |
| **AuditLog** | D | none (`actorId` = who acted) | ✗ | ✗ | ✗ | ✗ | read | insert | No user-facing read path exists | **No app-user policy.** INSERT only; SELECT staff-only | **CRITICAL** |
| **EmailVerificationToken** | D | `userId` | ✗ | ✗ | ✗ | ✗ | ✗ | rw | Server-only, looked up by hash | **No policy** — same shape as `PasswordResetToken` | **HIGH** |
| **FighterClaim** | A | `claimantId` | ✗ | read own | ✗ 404 | ✗ | read all | rw | Service + evidence route | `claimantId = app.user_id` OR staff | **HIGH** |
| **GymClaim** | A | `claimantId` | ✗ | read own | ✗ 404 | ✗ | read all | rw | Service + evidence route | `claimantId = app.user_id` OR staff | **HIGH** |
| **PromoterClaim** | A | `userId` | ✗ | read own | ✗ | ✗ | read all | rw | `lib/promoter/claims` | `userId = app.user_id` OR staff | **HIGH** |
| **PromoterOrg** | C | `ownerId` | read public | read; owner writes | read public | read | rw | rw | `lib/promoter/verification` capability table | `ownerId = app.user_id` for write; SELECT permissive | **HIGH** |
| **FeedCollection** | A* | `key` (mixed) | **see H-2** | rw own | **currently yes — H-2** | ✗ | ✗ | rw | **BROKEN — H-2** | Blocked on the namespace fix | **HIGH** |
| **FeedInterest / FeedView / FeedHiddenChannel / FeedNotInterested** | A* | `key` (mixed) | **see H-2** | rw own | **currently yes — H-2** | ✗ | ✗ | rw | **BROKEN — H-2** | Blocked on the namespace fix | **HIGH** |
| **ArticleView** | A* | `key` (mixed) | write own | rw own | same as above | ✗ | ✗ | rw | Same key model; read path is `lib/following` | Blocked on the namespace fix | MEDIUM |
| **Prediction** | C | `authorId` | read | read; author writes | read | read | read | rw | Public content; author-scoped write | `authorId = app.user_id` for write | MEDIUM |
| **CardAward** | C | `userId` | read (public boast) | read own | read | read | read | insert | Public by design (Victory Card) | SELECT permissive; INSERT service-only | MEDIUM |
| **ReputationEvent** | C | `userId` | read | read own | read | read | read | insert | Public profile history | SELECT permissive; INSERT service-only | MEDIUM |
| **Activity** | C | `userId` | read | read own | read | read | read | insert | Public activity feed | SELECT permissive; INSERT `userId = app.user_id` or service | MEDIUM |
| **Follow** | C | `userId` | read counts | rw own | read counts | read | read | rw | Owner-scoped writes | `userId = app.user_id` for write | MEDIUM |
| **FavoriteEvent / FavoritePromotion** | A | `userId` | ✗ | rw own | ✗ | ✗ | ✗ | rw | Owner-scoped | `userId = app.user_id` | MEDIUM |
| **CommunityMember** | B | `userId` + `communityId` | ✗ | read own membership | ✗ | ✗ | read | rw | `lib/community/repo` | `userId = app.user_id` OR member of community | MEDIUM |
| **ForumReaction** | C | `userId` | read counts | rw own | read counts | delete any | delete any | rw | Owner-scoped write | `userId = app.user_id` for write | LOW |
| **ForumReport** | D | `reporterId` | ✗ | insert own | ✗ | read | read | rw | `lib/moderation/reports` | INSERT `reporterId = app.user_id`; SELECT staff-only | **HIGH** |
| **CopyrightReport** | D | `reviewerId` (staff) | insert (public form) | insert | ✗ | read | read | rw | `/api/copyright` | INSERT permissive; SELECT staff-only | **HIGH** |
| **GymPhoto** | C | `uploadedById` + gym | read | read; gym staff write | read | delete any | rw | rw | Gym authorisation (`lib/gyms/authorise`) | SELECT permissive; write via gym membership | MEDIUM |
| **FighterIdentityCandidate** | D | `reviewerId` (staff) | ✗ | ✗ | ✗ | ✗ | rw | rw | `lib/admin/data-quality` | **No app-user policy** — staff/service only | MEDIUM |
| **ResultCandidate** | D | none (`reviewedById` staff) | ✗ | ✗ | ✗ | ✗ | rw | rw | `lib/results/pipeline` | **No app-user policy** — service only | LOW |

`A*` = owner-only in intent, **not currently achievable** — see H-2.

---

## Per-table detail — the CRITICAL set

### User

**Purpose:** the account. Root of every ownership chain in the schema.
**Row ownership:** self (`id`).
**Read rule:** public columns (`username`, `name`, `image`, `reputation`) are
world-readable — the profile, the leaderboard and every author byline depend on
it. Private columns (`email`, `passwordHash`, `tokenVersion`,
`professionalVerifiedAt`, `registryRole`) must never reach a client.
**Write rule:** self only, and only allow-listed columns
(CLAUDE.md rule 3 — signup/profile ignore injected `role`, `reputation`,
`picksCorrect`).
**Admin:** full read. **Moderator:** read. **Service:** rw.
**Current protection:** `SAFE_SELECT` in `src/lib/auth.ts` is the allow-list that
resolves a session; every public read goes through an explicit projection.

> **RLS is the wrong tool for the main risk here.** The threat is *column*
> exposure (`passwordHash`, `email`), and **RLS is row-level**. A permissive
> `SELECT true` policy protects nothing about columns. The control that matters
> stays the application projection. RLS should carry only
> `USING (id = app.user_id)` on UPDATE/DELETE — narrowing writes, not reads.
> **Anyone who believes enabling RLS on `User` protects password hashes has
> misunderstood the mechanism.**

**Threats:** mass assignment on profile update (mitigated, tested); column leak
via a full-object serialisation (no `NextResponse.json(user)` exists — verified);
enumeration via public ids (**this is real — see H-2**).
**Tests required:** UPDATE another user's row denied at the database; SELECT of
`passwordHash` never present in any API response.

### IdentityVerification

**Purpose:** a professional identity review request.
**Row ownership:** `userId`. `reviewerId` is the deciding staff member and is
**not** an ownership column — a reviewer does not own the row.
**Read:** own, or staff. **Write:** the submitter creates; only staff transition
`status` (`lib/identity-verification.setStatus` is the sole writer — asserted by
test). **Anonymous:** none. **Other USER:** 404, never 403 — a 403 would confirm
the id exists and turn enumeration into a list of who has submitted a passport.
**Sensitive columns:** `reviewNote` (staff-only; `myVerifications` excludes it —
asserted DB-level), `declineReason` (user-facing, deliberately separate).
**RLS requirement:** `userId = app.user_id` OR staff principal.
**Threats:** IDOR by verification id (mitigated: uniform 404); existence oracle
(mitigated); forged reviewer (impossible — reviewer comes from the session);
concurrent decisions (**fixed this session** — status-guarded `updateMany`).

### IdentityDocument

**Purpose:** one uploaded identity document.
**Row ownership:** *none directly.* Ownership is `verification.userId` — one hop
through the parent. **This is why a column heuristic missed it, and why the
policy must be an `EXISTS` subquery rather than a column comparison.**
**Read:** owner or staff, through the audited reader only.
**Sensitive columns:** `storageKey`, `storageProvider` — the key is the only
secret protecting the object. A test enumerates every file touching `storageKey`
and fails on anything that is not the store, the service or the reader.
**RLS requirement:**
`EXISTS (SELECT 1 FROM "IdentityVerification" v WHERE v.id = "verificationId" AND v."userId" = app.user_id)` OR staff.
**Threats:** IDOR by document id (mitigated — the reader checks the doc belongs
to the verification in the path, or a valid doc id would read out from under any
verification); storage-key leak (mitigated); retention failure (swept, with
retry on `FAILED`).

### AuditLog

**Purpose:** the record of who did what. It is **evidence**, and its integrity
matters more than its confidentiality.
**Row ownership:** none. `actorId` is who performed the action, not who owns it.
**Read:** staff only. There is no user-facing read path anywhere — verified.
**Write:** insert only, from services. **Nothing should ever UPDATE or DELETE an
audit row**, including admins through the UI.
**RLS requirement:** **no application-user policy.** Grant INSERT to the app
role; deny SELECT; deny UPDATE/DELETE to every principal except a migration
role. This is the one table where the right answer is "the application role
cannot read this at all".
**Threats:** an applicant editing the record of their own rejection; an admin
silently deleting evidence of their own action. Both are prevented by revoking
UPDATE/DELETE at the grant level rather than by policy.

---

## Connection and session model — **UNVERIFIED**, and it is the blocker

*Class: CODE + UNVERIFIED.* Per the owner's instruction I have no production
database credentials, so everything about the **current** role state is
unverified. Design conclusions from the schema and deploy config:

**Transaction-scoped context is mandatory.** `set_config('app.user_id', $1, true)`
— the third argument `true` means *local to the transaction*. A connection-level
`SET` is unsafe here: Prisma pools connections, so request B can inherit request
A's identity from a recycled connection. `src/lib/db-rls.ts` already uses the
bound-parameter form (`set_config($1,$2,true)`), never string interpolation —
correct, and it must stay that way, because interpolating a user id into that
call would be SQL injection into the security context itself.

**The context must not be forgeable.** `app.user_id` must be set from the
server-resolved session (`loadSession`, which reads the database and checks
`tokenVersion`), never from a header, query parameter or body field. H-2 is the
cautionary example of exactly this mistake made one layer up.

**Every query must be inside the transaction.** A Prisma call that escapes the
`withUser()` wrapper runs with no context, and a policy comparing against an
unset `app.user_id` will either deny everything or — worse, if written with a
`COALESCE` fallback — allow everything. Prefer denial.

**Background jobs and cron have no user.** They need an explicit service
identity: either a separate role, or a sentinel context value with policies that
recognise it. Silently running them with an unset context is how a "deny by
default" policy becomes an outage at 04:00.

**To verify (run in the Render shell, read-only):**

```sql
-- Which role does the app connect as, and can it bypass RLS?
SELECT current_user, session_user;
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
  FROM pg_roles WHERE rolname = current_user;

-- Does it own the tables? (an owner bypasses RLS unless FORCE is set)
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' LIMIT 20;

-- What is already enabled, and what policies exist?
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
SELECT * FROM pg_policies WHERE schemaname = 'public';
```

**Expected, based on CLAUDE.md and `render.yaml`:** the app connects as the
owner, `rolbypassrls` is false but irrelevant because ownership bypasses RLS
anyway, `relrowsecurity` is false everywhere, and `pg_policies` is empty.
**Unverified.**

## Target role — `app_rw`

Must **not** own the tables (ownership bypasses RLS), and must not hold
`BYPASSRLS`, `CREATEROLE`, `CREATEDB` or `SUPERUSER`. It needs
`SELECT/INSERT/UPDATE/DELETE` on the application tables and `USAGE` on the
schema and sequences — nothing more.

Migrations need a **separate** role. `prisma db push` issues DDL, which the
runtime role must not be able to do; giving the runtime role DDL rights to save a
role is how the runtime ends up able to `ALTER TABLE … DISABLE ROW LEVEL
SECURITY`.

`FORCE ROW LEVEL SECURITY` should be set on every Group A table regardless, so
that a future accidental switch back to the owner connection does not silently
disable every policy.

## Prisma / `db push` interaction — **the deployment hazard**

`render.yaml` runs `prisma db push --accept-data-loss` on **every deploy**. Two
consequences that must be settled before activation:

1. `db push` reconciles the schema to `schema.prisma`. Policies are **not** in
   `schema.prisma`. Whether a given `db push` preserves or drops them depends on
   what it decides to alter — a table it recreates loses its policies silently,
   and the deploy goes green.
2. There is therefore **no drift detection**. Production could lose RLS on a
   Tuesday and nothing would report it.

**Required:** a post-deploy assertion that fails the deploy if
`pg_policies` does not contain the expected set — the same shape as
`verify.sql`, run as a deploy step rather than by hand. Without it, RLS is a
control that can silently uninstall itself, which is worse than not having it,
because the team will believe it is there.

---

## Proposed policies — **NOT APPLIED**

Illustrative, for the CRITICAL set only. These are proposals for review, not
tested SQL.

```sql
-- IdentityVerification — owner reads own; staff handled by a separate role/policy.
ALTER TABLE "IdentityVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdentityVerification" FORCE ROW LEVEL SECURITY;

CREATE POLICY iv_owner_select ON "IdentityVerification"
  FOR SELECT TO app_rw
  USING ("userId" = current_setting('app.user_id', true));

-- WITH CHECK, not USING: USING filters which existing rows are visible/updatable;
-- WITH CHECK validates the row AFTER the write. Without it a user could UPDATE
-- their own row to set userId to somebody else's and hand the record away.
CREATE POLICY iv_owner_insert ON "IdentityVerification"
  FOR INSERT TO app_rw
  WITH CHECK ("userId" = current_setting('app.user_id', true));

-- IdentityDocument — ownership is one hop through the parent.
ALTER TABLE "IdentityDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdentityDocument" FORCE ROW LEVEL SECURITY;

CREATE POLICY id_owner_select ON "IdentityDocument"
  FOR SELECT TO app_rw
  USING (EXISTS (
    SELECT 1 FROM "IdentityVerification" v
    WHERE v.id = "IdentityDocument"."verificationId"
      AND v."userId" = current_setting('app.user_id', true)
  ));

-- AuditLog — insert-only for the application. No SELECT policy at all,
-- so the app role can write evidence and never read or alter it.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE ON "AuditLog" FROM app_rw;

CREATE POLICY audit_insert ON "AuditLog"
  FOR INSERT TO app_rw WITH CHECK (true);
```

**`USING` vs `WITH CHECK`, stated once because conflating them is the classic
RLS bug:** `USING` decides which rows a statement can *see* (SELECT, and the
"before" image of UPDATE/DELETE). `WITH CHECK` validates the row a write
*produces* (INSERT, and the "after" image of UPDATE). A policy with `USING` and
no `WITH CHECK` lets a user take a row they legitimately own and rewrite its
owner to somebody else.

---

## Verification plan

Principals: **anonymous · USER A · USER B · MODERATOR · ADMIN · SERVICE**.
For each Group A/B table, every principal × {SELECT, INSERT, UPDATE, DELETE},
asserting at the **database** layer — not through the API, or the test proves the
application guard rather than the policy.

Must include: legitimate self-access; cross-user by forged id; forged
`app.user_id`; **unset** `app.user_id` (must deny, not allow); context set then
transaction rolled back; two interleaved transactions on one pooled connection
(the leak case); membership removed mid-session; hidden/soft-deleted rows; and
`SET ROLE` attempts by the app role.

The single assertion the whole exercise exists for:

> **USER A cannot become USER B by changing an identifier.**

---

## The other 33 tables — bulk justification

`ArticleTag · Champion · ChampionObservation · CommunityMarket · DataSource ·
EventExternalId · FeedCollectionItem · FeedVideo · FightImport ·
FighterAchievement · FighterAlias · FighterExternalId · FighterMedia ·
FighterSocial · FighterSponsor · ForumCategory · ImportConflict · JobLease ·
Language · NewsOutlet · OddsSnapshot · PromotionSource · ProviderCheckpoint ·
ProviderHealth · ProviderSync · RankSnapshot · RankingObservation ·
RankingSnapshot · ResultEvidence · ScrapeJob · Tag · Title · TitleReign`

**Group C (public read) or system-only (no application-user access).** None
carries a person reference; all are scraper output, reference data or ingestion
machinery. They need a permissive `SELECT true` guard rail if RLS is enabled
schema-wide, and write access restricted to the service role.

**Two exceptions to confirm before bulk-classifying:** `FeedCollectionItem`
belongs to a `FeedCollection` and therefore inherits H-2's ownership problem
through its parent; `JobLease` and `ProviderCheckpoint` are operational locks
where a hostile write is a denial-of-service on ingestion, not a data leak.

---

## Unresolved questions

1. **H-2 must be fixed before RLS activation.** The current `key` namespace
   cannot be expressed as a safe policy — see the finding.
2. **Current role state is UNVERIFIED.** The queries above settle it.
3. **How does staff access work?** Three options with different consequences:
   a separate privileged role (cleanest — admin traffic never runs under
   `app_rw`); a `app.is_staff` context flag (simplest — but forgeable if ever set
   from anything but the server session); or policies that check a staff table
   (correct but adds a join to every query). **Recommend a separate role**, so an
   application bug cannot escalate an ordinary session to staff.
4. **`db push` drift detection** must exist before activation, or RLS can
   silently uninstall itself on any deploy.
5. **`User` cannot be protected by RLS in the way people will assume.** The
   column-exposure risk stays an application concern. This should be written into
   CLAUDE.md so it is not rediscovered.

**Production security status remains YELLOW. Nothing in this document was
applied.**
