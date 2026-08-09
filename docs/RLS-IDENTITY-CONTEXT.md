# RLS identity context and deployment persistence — evidence

**Status: NOTHING WAS ACTIVATED.** No production role was created, no policy
applied, no production state read or written. Every experiment below ran against
a disposable local PostgreSQL 16 container that was destroyed afterwards.

Evidence classes: **PROVEN** (executed and observed) · **DESIGNED** (specified,
not yet executed) · **UNVERIFIED** (cannot be established without production
access, with the reason stated).

---

## The blocking gate, stated first

**Phase 2 (production role audit) and Phase 11 (activation) cannot be done by
me. I have no production database credentials.**

Per the brief's own rule — *"If production role inspection is impossible: STOP
BEFORE ACTIVATION. Do not pretend the role state is known."* — this document
stops at that gate. What follows is everything that could be established without
production, which turns out to include the two questions that most affect the
design.

To unblock, run these **read-only** queries in the Render shell and paste the
output:

```sql
SELECT current_user, session_user, current_database(), version();

SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
  FROM pg_roles WHERE rolname = current_user;

SELECT tablename, tableowner FROM pg_tables
  WHERE schemaname = 'public' ORDER BY tablename LIMIT 30;

SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
    AND (relrowsecurity OR relforcerowsecurity);

SELECT count(*) AS existing_policies FROM pg_policies WHERE schemaname = 'public';

-- Can the deploy user even create the runtime role?
SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create;
```

Until that output exists, the current production role state is **UNVERIFIED**.

---

## FINDING R-1 · `prisma db push` silently destroys RLS on a recreated table — **PROVEN**

This is the finding that governs the rollout, and it was an open question in
`docs/RLS-TABLE-CLASSIFICATION.md`. It is now answered by experiment.

Setup: fresh PostgreSQL 16, full schema pushed, then RLS enabled and forced on
`IdentityVerification` with an owner policy, and RLS + a policy on
`FeedbackVote`. Then the **exact production deploy command** was run —
`npx prisma db push --skip-generate --accept-data-loss`, verbatim from
`render.yaml`.

| Scenario | `db push` said | RLS after |
|---|---|---|
| **A** · no schema change (the ordinary deploy) | in sync | `rls=true force=true policies=1` — **survives** |
| **B** · column added to the protected table | "Your database is now in sync" | `rls=true force=true policies=1` — **survives** |
| **C** · **model renamed** (`FeedbackVote` → `FeedbackVoteRenamed`) | **"Your database is now in sync"** | old table's policies **gone**; new table **`rls=false policies=0`** |

**Scenario C is the danger.** A rename is implemented as drop + create. The
policies die with the old table, the new table is created with RLS off, and the
deploy reports success. Nothing fails. Nothing warns. The application keeps
serving, now with that table's database backstop silently removed.

The same applies to any change that recreates a table, not only renames.

**Consequence for the rollout — non-negotiable.** RLS must not be activated
without a **post-deploy verification gate** that fails the deploy when the
expected policy inventory is absent. Without it, RLS is a control that can
uninstall itself, which is worse than not having it: the team believes it is
there. `prisma/rls/verify.sql` exists but is not wired into the deploy; it must
become a build step that exits non-zero.

**Also required:** RLS application must be **idempotent** and re-run on every
deploy, so a table recreated by `db push` is re-protected in the same deploy
that dropped it.

---

## FINDING R-2 · Ownership and BYPASSRLS both defeat RLS — **PROVEN**

| Role | `rolsuper` | `rolbypassrls` | Rows visible under RLS **+ FORCE**, no context |
|---|---|---|---|
| `owner` (container superuser) | true | **true** | **2 of 2 — sees everything** |
| `app_rw` | false | false | **0** |

`FORCE ROW LEVEL SECURITY` makes policies apply to the table **owner** — but it
does **not** apply to a superuser or to any role holding `BYPASSRLS`. So:

- The runtime role must not be a superuser.
- The runtime role must not hold `BYPASSRLS`.
- `FORCE` is still required, because the runtime role may end up owning tables
  through a future migration and ownership alone would otherwise bypass.

This is the concrete confirmation of the claim in CLAUDE.md that applying
`policies.sql` while the app connects as the owner "would achieve nothing" — with
the refinement that **`FORCE` does fix the owner case**; it is superuser and
`BYPASSRLS` that cannot be fixed by any policy.

---

## FINDING R-3 · Transaction-local identity is leak-free across a pooled connection — **PROVEN**

The property everything else depends on: request B must never inherit request
A's identity from a recycled connection.

Executed as `app_rw` in **one psql session** (one connection, reused throughout),
against `IdentityVerification` with RLS + FORCE and the policy
`USING ("userId" = current_setting('app.user_id', true))`:

| # | Action | Observed |
|---|---|---|
| 1 | No identity context | **`rows=0`** — fails closed |
| 2 | `BEGIN; set_config('app.user_id','u_alice',true)` | `rows=1 ids=iv_a` — alice's row only |
| 3 | **After `COMMIT`, same connection** | **`rows=0` — context did not leak** |
| 4 | `BEGIN; set_config(…,'u_bob',true)` on that same connection | `rows=1 ids=iv_b` — bob's row only |
| 5 | Context set then `ROLLBACK` | **`rows=0`** — did not survive |

**What this proves.** The third argument `true` to `set_config` makes the setting
transaction-local, and PostgreSQL discards it at COMMIT *and* at ROLLBACK. A
connection returned to the pool carries no identity. Step 1 is equally important:
an unset context yields **zero rows**, not all rows — the failure mode is denial,
not disclosure.

**`src/lib/db-rls.ts` already implements exactly this**: a transaction wrapper
issuing `set_config($1, $2, true)` with **bound parameters**, never string
interpolation. That detail matters more than it looks — interpolating a user id
into that call would be SQL injection directly into the security context.

**Still DESIGNED, not proven:** the same behaviour through Prisma's pool under
concurrency, and the behaviour of an external pooler (PgBouncer in *transaction*
mode is compatible with `SET LOCAL`; **statement** mode is not). Whether Render
puts a pooler in front of this database is **UNVERIFIED**.

---

## What remains before activation

| Gate | State |
|---|---|
| Classification of the security-relevant tables | done (`RLS-TABLE-CLASSIFICATION.md`) |
| Classification of the remaining 33 system tables | **outstanding** |
| Production role audit | **UNVERIFIED — blocked on credentials** |
| Pooler topology (direct vs PgBouncer, and its mode) | **UNVERIFIED** |
| `db push` persistence | **PROVEN unsafe for recreated tables (R-1)** |
| Idempotent RLS apply step | **not built** |
| Post-deploy policy-drift gate | **not built** — mandatory per R-1 |
| Identity context correctness | **PROVEN (R-3)** |
| Non-owner role design | designed; `app_rw` provisioned and tested locally only |
| Database-level cross-user attack matrix | partially proven (R-3); full matrix outstanding |
| Background-job / admin service identity | **DESIGNED only** — nothing decided |

**Recommended order**, unchanged by these findings except that the drift gate is
now a hard prerequisite rather than a nice-to-have:

1. Run the read-only audit queries above; settle the role state.
2. Establish the pooler topology.
3. Build the idempotent apply + the failing verification gate **first**.
4. Provision `app_rw` (no `BYPASSRLS`, not superuser, not owner).
5. Apply policies in staging; run the full attack matrix as `app_rw`.
6. `RLS_SESSION_CONTEXT=1`, then production off-peak, with
   `DISABLE ROW LEVEL SECURITY` as the tested rollback.

**Security status remains YELLOW.** RLS is still NOT ENFORCED. Nothing in this
document changed that, and nothing in it should be read as having activated
anything.
