# Production security audit — Combat Reviews

**Date:** 2026-08-09 · **Scope:** whole application · **Auditor:** Claude Opus 5, driven by the repository owner.

This document separates what was **proven** from what was **read**. Every claim
carries its evidence class:

| Class | Meaning |
|---|---|
| **PROD** | Verified against the deployed application over HTTP |
| **DB** | Verified against a real PostgreSQL instance |
| **CODE** | Verified by reading or statically asserting on source |
| **UNTESTED** | Not verified — the reason is stated |

The single biggest limitation is stated up front, because it qualifies
everything below: **no authenticated testing was performed.** There were no
browser tools and no credentials for this session, so every live probe was
anonymous. Cross-account authorization (USER → another USER's object) is
covered by DB-level tests, **not** by live HTTP.

---

## Executive summary

```
SECURITY STATUS:            YELLOW
CRITICAL:                   0 open  (1 found and fixed)
HIGH:                       0 open  (2 found and fixed — H-1 verification race, H-2 feed identity)
MEDIUM:                     3 open
LOW:                        3 open
RLS STATUS:                 NOT ENFORCED — application-layer only (documented, accurate)
ADMIN STATUS:               GREEN
IDENTITY DOCUMENT STATUS:   GREEN
AUTH STATUS:                GREEN
API STATUS:                 GREEN
CSP STATUS:                 GREEN (enforced, nonce-based)
PRODUCTION GO/NO-GO:        GO for launch — with the residual risks below accepted
```

**Top 5 remaining risks**

1. **PostgreSQL RLS is not enforced.** One layer (application ownership) protects
   every private row. A single missing `where: { userId }` is a data breach with
   nothing behind it. And the classification that would drive its rollout omits
   thirteen ownership-bearing tables, **including both identity-document tables**
   (M-3) — so the rollout must not start from the list as it stands.
2. **No authenticated live testing has ever been done.** The cross-account
   guarantees are proven against a database, not against the deployed app.
3. **JSON-LD under the new enforced CSP** — mitigated by nonce this session, but
   the browser behaviour was never observed.
4. **Rate limiting fails open if Redis is unavailable** (unverified — see M-2).
5. **Account deletion vs. authored public content** — behaviour is defined but
   was not exercised end-to-end.

---

## Findings

### C-1 · Every server admin page leaked its query results to anonymous callers — **FIXED**

*Class: PROD.* `curl https://…/admin` with no cookie returned **200** with
`"children":"7"` beside `"Registered accounts"` in the RSC payload.

A layout and its page render **in parallel** in the App Router. `notFound()` in
`admin/layout.tsx` swaps the UI for the 404 boundary; it does not cancel the
sibling page, which has already run its queries and streamed the results. The
layout was a UI guard and never a data guard.

Seven server pages affected. The material one is `/admin/identity-verification`,
whose select carries every applicant's **name, username and email** — those would
have gone to any anonymous caller the moment a submission existed. Nothing had
been submitted, so actual disclosure was a user count, an event count and three
zero counters.

**Fix:** `await requireAdminPage()` as the first statement of all seven.
**Regression test:** `src/lib/__tests__/identity-verification-security` walks
every server page under `app/admin` and fails on any that reads data unguarded.
**Verified:** PROD — all admin routes now return 0 private-content hits.

### H-1 · Two reviewers could both decide one verification — **FIXED**

*Class: DB.* `reviewVerification` read the status, checked `isOpen()`, then
updated. Two reviewers with the same queue open is the ordinary case. Worst
outcome: an APPROVE landing after a DECLINE still ran its
`professionalVerifiedAt` update — **a rejected applicant wearing a verified
badge**.

**Fix:** status-guarded `updateMany` inside the transaction; losing the claim
throws and rolls back the audit row and the badge with it.
**Regression test:** `test/integration/identity-verification` runs two decisions
concurrently. Reverting the fix makes it fail; restoring it makes it pass.

### M-1 · PostgreSQL RLS is staged, not applied — **OPEN, accepted**

*Class: CODE.* Verified rather than assumed:

- `prisma/rls/policies.sql` and `verify.sql` exist.
- **Nothing applies them.** `render.yaml`'s build command is
  `npm ci && prisma db push && npm run build` — no apply step.
- `RLS_SESSION_CONTEXT` appears **nowhere** in `render.yaml`, so `withUser()` in
  `src/lib/db-rls.ts` is inert.
- The app connects as the table **owner**, and an owner bypasses RLS unless
  `FORCE ROW LEVEL SECURITY` is set — so applying the policies without first
  provisioning a non-owner role would achieve nothing.

CLAUDE.md's description is therefore **accurate**, which is itself worth
recording: the documentation does not overstate the control.

**Impact.** Defence in depth is absent for private rows. The application layer is
correct today — `npm run security:audit` greps for private-table reads missing an
ownership filter and reports **0 HIGH** — but it is the *only* layer.

**Recommendation (not done here — it is a deployment change, not a code fix):**
provision an `app_rw` non-owner role → ship `RLS_SESSION_CONTEXT=1` → apply
`policies.sql` → run `verify.sql` → production off-peak with
`DISABLE ROW LEVEL SECURITY` as the tested rollback. This is the order CLAUDE.md
already specifies.

### H-2 · Anonymous feed identity confusion — caller-controlled namespace — **FIXED**

*Class: PROD + CODE + DB.* Found while classifying the `Feed*` tables for the RLS
rollout (see `docs/RLS-TABLE-CLASSIFICATION.md`).

**Before.** `feedKey` returned `uid ?? fallbackCid`, and `fallbackCid` came
straight off the query string or JSON body. A signed-in caller was safe — the
session wins. An **anonymous** caller chose their own storage key. And `User.id`
is not a secret: `/leaderboard` serves cuid values beside usernames in its RSC
payload. So an unauthenticated attacker could read an id off a public page and
address that person's personalisation namespace:

```
GET  /api/feed/library?cid=<key>        → 200, that key's collections
POST /api/feed/prefs {"cid":"<key>"}    → 200 {"ok":true}
```

Both confirmed against production **with a synthetic key**. No real user's data
was read or written: an attempt to prove it against a real leaderboard id was
correctly blocked as a destructive production action and was not retried.

**Impact.** Unauthenticated read of a named user's saved video library, and
unauthenticated write to their feed preferences (hidden channels, not-interested,
interest weights). Personalisation, not documents — **HIGH, not CRITICAL** — but
unauthenticated, read *and* write, targeted at a named person.

**After.** Two namespaces that cannot collide. Authenticated identity stays the
**raw session user id** — unchanged, so no signed-in user loses a row, and it
matches what `following.ts` and `home/recommendations.ts` already write directly.
Anonymous identity is **always** `anon:`-prefixed, so a caller-supplied value can
never equal a `User.id`. The impersonation is not blocked by a check; it is
unrepresentable.

Two further holes closed in the same function: the `catch` branch used to return
`fallbackCid`, so a request that could induce a session error got to name its own
identity; and a missing/junk id collapsed to the bare literal `"anon"`, which sat
in the same row-space as user ids.

**No compatibility fallback, deliberately.** Reading through to the bare key when
the namespaced one is empty would restore existing anonymous rows *and* reopen
the vulnerability exactly — attacker sends `cid=<victim id>`, namespaced lookup
misses, fallback hits the victim. Signed-out personalisation resets once instead.
Authenticated data is untouched.

**Evidence.** Unit suite asserts `feedKey` returns only the session uid or a
value through `anonKey`, on every path. Integration suite proves four principals
write four row-spaces and that an attacker's namespaced key reaches none of user
A's rows. **Both suites were verified non-vacuous**: the first version passed
against a deliberately reintroduced `return fallbackCid` — it tested `anonKey`
rather than `feedKey`, the function that was actually vulnerable — and was
rewritten until the vulnerable code fails it (10/10 → 9/10 with the exact
message; integration 4/4 → 2/4).

**RLS did not fix this and does not protect it.** RLS remains NOT ENFORCED. This
is an application-layer fix, and it is a prerequisite for the RLS rollout: the
old mixed namespace could not be expressed as a safe policy.

### M-3 · Thirteen ownership-bearing tables are absent from the RLS classification — **SUPERSEDED**

The real number is **62 of 101**, not 13, and the corrected classification is in
`docs/RLS-TABLE-CLASSIFICATION.md`. The 13 was an artefact of deriving scope from
a regex over ownership column names — a method structurally blind to
`IdentityDocument` (no person column; scoped through its parent) and to `User`
itself. **Derive RLS scope from access paths, never from column names.**

### M-3b · Thirteen ownership-bearing tables are absent from the RLS classification — **OPEN**

*Class: CODE.* CLAUDE.md instructs: *"When you add a table, place it in the RLS
classification below."* The schema has **101 models**; **45** carry an ownership
column (`userId`/`ownerId`/`authorId`/`followerId`/`senderId`/…); the
classification names 50 tables in total. Cross-referencing the two lists, these
ownership-bearing tables appear **nowhere** in it:

```
IdentityVerification      IdentityDocument        ← the passport tables
FighterClaim              GymClaim                PromoterClaim   ← identity evidence
EmailVerificationToken    ← sibling of PasswordResetToken, which IS classified
Prediction                Activity                ReputationEvent
CardAward                 CommunityMember         Follow          ForumReaction
PromoterOrg
```

`FavoriteFighter/Promotion/Event` looked missing but is present under a combined
notation — not a finding.

**Why this matters more than a documentation gap.** The classification is the
input to the RLS rollout: it decides which tables get an owner-only policy, which
get a permissive public-read guard rail, and which are deliberately public.
Rolling out from a list that omits `IdentityVerification` and `IdentityDocument`
would leave **the most sensitive rows in the product** — identity documents and
the decisions about them — as the only ones with no policy, while lower-value
tables got one. That is the precise failure mode of "enable RLS everywhere and
see what breaks".

**No exposure today.** These tables are correctly protected at the application
layer — the identity document reader is owner-or-staff with a uniform 404, the
claim flows are service-scoped, and the query auditor reports 0 HIGH. This is a
gap in the *plan*, not in the current control.

**Recommendation:** complete the classification **before** provisioning the
non-owner role, not during the rollout. Each of the thirteen needs an explicit
decision: owner-only, membership-scoped, public-read-with-private-columns, or
server-only-with-no-policy (the shape `PasswordResetToken` already uses).

### M-2 · Rate-limit behaviour when Redis is unavailable — **OPEN, unverified**

*Class: UNTESTED.* `src/lib/rate-limit` has both a Redis and an in-memory store.
Whether a Redis outage fails **open** (all limits lifted) or **closed** (all
writes refused) was not exercised, and the correct answer differs per route:
failing open on `login` is a brute-force window; failing closed on voting is an
outage.

**Recommendation:** assert the degraded path explicitly, per policy class.

### L-1 · `/admin` returns 200 with 404 content

*Class: PROD.* The layout commits the response before the page throws, so the
status line is 200 while the body is the not-found boundary. **No data** — this
is cosmetic, and admin routes are `noindex`.

### L-2 · JSON-LD and the enforced CSP

*Class: UNTESTED (mitigated).* `script-src` no longer carries `'unsafe-inline'`.
`<script type="application/ld+json">` is an inline script element, and engines
disagree about whether `script-src` governs non-executable data blocks. The
failure would be silent — no user-visible error, just search engines losing the
fighter and article markup.

**Mitigation applied:** `JsonLd` now carries the per-request nonce from
`x-nonce`, which is correct under either interpretation.
**Still needs:** one browser load of `/fighters/<slug>` with the console open.

### L-3 · Dev-only dependency vulnerabilities

*Class: CODE.* `npm audit --omit=dev` → **0 vulnerabilities**. The full tree has
19, all in `lighthouse` and its OpenTelemetry/Sentry transitives, none of which
reach the deployed artifact. Clearing them needs a `lighthouse` major bump.

---

## Verified secure

### Authentication & session — GREEN

*Class: CODE.* The session is resolved from the **database on every request**,
not decoded from the cookie: `loadSession` verifies the JWT, then loads the user
through an allow-listed `SAFE_SELECT` and compares `tokenVersion` against the
token's epoch. Consequences worth stating:

- A role change takes effect immediately; there is no stale-privilege window
  from a cached claim.
- Bumping `tokenVersion` (password change, reset, sign-out-everywhere) revokes
  every outstanding session at once.
- A tampered or stale-epoch token resolves to **anonymous**, never to a partial
  identity.
- `role` is never read from the client. `isAdminRole()` takes `User.role` and no
  value of `registryRole` satisfies it (asserted at runtime against the real
  predicate).

### Admin authorization — GREEN

*Class: PROD + CODE.* One authoritative definition in `src/lib/admin/roles.ts`.
This audit's predecessor found **four** private copies of the rule — including
one in a file named `guard.server.ts` gating a real endpoint — all of which
*agreed* with the real rule, which is what made them dangerous. All four now
import it, and a test fails if a fifth appears.

PROD: `/api/admin/*` → **403** anonymous. Every admin page → 0 private-content
hits.

### Identity documents — GREEN

*Class: CODE + PROD.* Private bucket enforced at the store; magic-byte MIME
validation; polyglot detection; EXIF stripping (a phone photo of a passport
carries the GPS of wherever it was taken); malware scan on the **original**
bytes; size checked before the buffer is read.

The reader is **owner-or-staff**, returns a **uniform 404** for anonymous,
stranger, wrong id and missing row alike — so it is not an existence oracle —
sends `private, no-store` plus a sandboxed CSP, and writes an audit row on every
successful read. PROD: `/api/admin/identity-verification/x/document/y` → **404**.

Storage keys never leave the server: a test enumerates every file touching
`storageKey` and fails on anything that is not the store, the service or the
reader. The user's own history returns neither a key nor the staff-only
`reviewNote` (asserted DB-level).

### Injection — GREEN

*Class: CODE.* One `$executeRawUnsafe` exists, in `lib/forum/realtime.ts`. Its
interpolated value is a **module constant** (`CHANNEL = "forum_events"`); the
payload uses `$1` parameterisation. No user input reaches raw SQL anywhere.

One `dangerouslySetInnerHTML`, in `components/seo/json-ld.tsx`, behind an escaper
that converts `&`, `<`, `>`, U+2028 and U+2029 to `\uXXXX` — the sequences
`JSON.stringify` does *not* escape and which allow a `</script>` breakout. No
feedback or forum component uses it (asserted).

### Identity ≠ ownership — GREEN

*Class: CODE.* Verifying that John is John does not make John the owner of a
promotion. Approval writes **no** ownership of any kind — a test fails if it ever
writes an `ownerId`, touches a claim table, or if promoter capability starts
reading the identity badge. Ownership stays a separate claim → evidence →
human-decision flow.

### Feedback board — GREEN

*Class: DB.* One vote per member is a **composite primary key**, not an
application check: three simultaneous votes from one account produce exactly one
row. Vote counts are `_count` on the relation — never sent by a client, never
stored, nothing to forge. The author cannot set `status` (no parameter accepts
one). `adminNote` is excluded by an explicit public projection, asserted absent
from public reads along with author emails.

### Secrets — GREEN

*Class: CODE.* No `.env`, `.pem` or key files tracked. No hardcoded credential
literals in `src/`. The five `NEXT_PUBLIC_*` variables are all non-sensitive
(commit SHA, map tile URL/attribution, site URL, R2 origin). No secret is
referenced from any client component.

### Caching — GREEN

*Class: PROD.* Every sensitive route sampled — `/admin/*`, `/account/verification`,
`/messages`, `/notifications`, `/profile`, `/predictions/mine`, `/feedback/mine`
— returns `private, no-cache, no-store`.

One gap was found and fixed this session: `/api/verification/identity` returned a
per-user identity record with **no `Cache-Control` at all**. `force-dynamic`
stops *Next* caching it and says nothing to a CDN, a corporate proxy or the
browser's disk cache.

### CSP and headers — GREEN

*Class: PROD.* Enforced, nonce-based, verified on the deployed app: **846 script
tags across 12 routes, 0 without a nonce**, no `Report-Only` anywhere, fresh
nonce per request. Full policy and the reasoning for the one documented
exception (`style-src 'unsafe-inline'`, because React writes `style={{…}}` as an
attribute and attributes cannot carry a nonce) are in `src/middleware.ts`.

Also live: HSTS with preload, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.

### CSRF — GREEN

*Class: CODE.* State-changing endpoints are JSON `POST`/`PATCH`/`DELETE` behind a
`sameSite=lax` httpOnly cookie, and the write routes additionally require
`content-type: application/json` — a cross-site form post carries neither the
cookie nor that content type.

---

## Scorecard

| Area | Status | Basis |
|---|---|---|
| Database / RLS | **YELLOW** | RLS not enforced; application layer correct, 0 HIGH in the query auditor |
| Authentication | GREEN | CODE — DB-resolved session, epoch revocation |
| Authorization | GREEN | PROD + CODE |
| Admin security | GREEN | PROD — was RED before C-1 |
| Private data | GREEN | PROD + DB |
| Upload security | GREEN | CODE — full pipeline reviewed |
| API security | GREEN | PROD — anonymous matrix |
| CSRF | GREEN | CODE |
| Rate limiting | **YELLOW** | Present everywhere; degraded-Redis path unverified (M-2) |
| CSP / headers | GREEN | PROD |
| Dependencies | GREEN | 0 production vulnerabilities |
| Secrets | GREEN | CODE |
| Logging / audit | GREEN | CODE — decisions and document views audited, actor from session |
| Deployment | **YELLOW** | RLS activation outstanding |
| Incident readiness | **YELLOW** | Audit trail exists; no documented response runbook |

---

## What was not tested, and why

- **Authenticated live testing.** No browser tools, no credentials. Cross-account
  authorization is proven at the database layer only.
- **Redis-down rate limiting** (M-2).
- **JSON-LD rendering under the enforced CSP** (L-2) — mitigated, not observed.
- **Account deletion → authored public content** end-to-end.
- **Webhook/scraper ingress** was reviewed for authorization (cron secret) but not
  fuzzed.

This audit does not claim the application is unhackable. It claims that the
attack paths listed above were looked for, that the ones found were fixed with
regression tests that fail if they return, and that the remaining risks are
named rather than absent.
