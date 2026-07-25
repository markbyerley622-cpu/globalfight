# Database hardening: Row-Level Security (RLS) plan

> Status: **PLAN + reviewable template — NOT yet applied.** Enabling RLS wrong is
> a total-outage risk (see "Why this isn't just switched on"). This document is
> the safe path to get there. The immediate, already-in-place protection is
> application-layer authorization (every private read is scoped `where: { userId }`).

## The framing correction

"RLS on all tables" is not the goal, and applying it literally would break the
product. GlobalFight has **75 models**, and the majority are **public content**
that must stay world-readable to anonymous visitors:

- Fighters, Events, Fights, Rankings, Articles, Gyms, GymPhotos, **GymReviews**,
  ForumThreads, ForumPosts, Promotions, community vote **aggregates**.

Restrictive RLS on those tables would blank the entire public site. RLS is a tool
for **owner-private** rows, applied selectively.

## Table classification

**A — Private (owner-only reads): RLS `USING (owner = current user)`**
`Session`, `Account`, `PasswordResetToken`, `PushSubscription`, `Notification`,
`FightPick` (individual picks; the crowd aggregate is derived, not row-exposed),
`ForumBookmark`, `ForumSubscription`, `FavoriteEvent/Fighter/Promotion`,
`AnalyticsEvent`, `CheckIn` (location — extra sensitive).

**B — Public content, owner-only *writes*:** `ForumThread`, `ForumPost`,
`GymReview`, `GymReviewVote`, `Gym`, `Article`, `CommunityVote`, `Rivalry`,
`Battle`. Reads are public; writes are already guarded in the app + rate-limited.
RLS here (if used) is *permissive read, restricted write* — not owner-only read.

**C — Fully public, read-only to users:** `Fighter`, `Event`, `Fight`, `Ranking`,
`WeightClass`, `Promotion`, etc. No RLS, or RLS enabled with a permissive
`SELECT true` policy so an accidental global FORCE can't blank them.

## Why this isn't just switched on

1. **`prisma db push` does not manage RLS.** Policies are raw SQL; there is no
   migration step in the current deploy (`buildCommand` runs `db push`) that would
   apply them. They must be applied by a dedicated step (add `psql -f` of this
   file to the build, or a one-off run), and re-applied on schema changes.
2. **The app connects as one role via `DATABASE_URL`.** If that role is the table
   **owner**, RLS is ignored unless `FORCE ROW LEVEL SECURITY` is set; if it's a
   **superuser**, RLS is *always* bypassed. So RLS requires the app to connect as
   a **non-superuser, non-owner** role (e.g. `app_rw`) with table `GRANT`s.
3. **Per-request user context.** The policies below reference
   `current_setting('app.user_id', true)`. Nothing sets that today. Prisma needs a
   client extension / `$transaction` wrapper that runs
   `SET LOCAL app.user_id = '<id>'` at the start of every request's queries.
   Without it, every policy evaluates to "no user" and **all private reads return
   empty** — a silent, sitewide data-disappearance bug.

Get any of the three wrong and you either (a) achieve nothing (superuser bypass)
or (b) take the site down. That is why this is staged, not toggled.

## Rollout (safe order)

1. Create role `app_rw` (non-superuser); `GRANT SELECT/INSERT/UPDATE/DELETE` per
   table. Point `DATABASE_URL` at it in a **staging** DB first.
2. Add the Prisma session-context extension (sets `app.user_id` per request).
   Ship it behind a flag; verify normal traffic still works with it on.
3. Apply `policies.sql` (below) in **staging**. Run the full app + integration
   tests. Confirm: a user cannot read another user's picks/notifications; public
   pages still render anonymously.
4. Only then repeat in production, off-peak, with a tested rollback (`ALTER TABLE
   … DISABLE ROW LEVEL SECURITY`).

## Session-context extension (sketch — wire in step 2)

```ts
// Sets the RLS user for every query in a request. Prisma has no per-query hook
// for raw SET, so private reads run inside a tx that sets it first.
export function withUser<T>(userId: string, fn: (tx) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.user_id = '${userId.replace(/'/g, "")}'`);
    return fn(tx);
  });
}
```

## policies.sql (template — Group A private tables)

```sql
-- Helper: the current request's user id, or NULL when unset.
--   current_setting('app.user_id', true)  -- 'true' = don't error when missing

-- Notifications: you see only yours.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY notif_owner ON "Notification"
  USING ("userId" = current_setting('app.user_id', true));

-- Individual picks (aggregate is derived server-side, not via this table).
ALTER TABLE "FightPick" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FightPick" FORCE ROW LEVEL SECURITY;
CREATE POLICY pick_owner ON "FightPick"
  USING ("userId" = current_setting('app.user_id', true));

-- Auth/session material: never readable across users.
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" FORCE ROW LEVEL SECURITY;
CREATE POLICY session_owner ON "Session"
  USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY push_owner ON "PushSubscription"
  USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "CheckIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckIn" FORCE ROW LEVEL SECURITY;
CREATE POLICY checkin_owner ON "CheckIn"
  USING ("userId" = current_setting('app.user_id', true));

-- PasswordResetToken: no user reads it at all (server-only, by token hash).
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
-- No permissive policy → only the table owner / a BYPASSRLS job can read it.

-- Favourites / bookmarks / subscriptions: owner-only.
ALTER TABLE "ForumBookmark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForumBookmark" FORCE ROW LEVEL SECURITY;
CREATE POLICY bookmark_owner ON "ForumBookmark"
  USING ("userId" = current_setting('app.user_id', true));
-- …repeat for ForumSubscription, FavoriteEvent/Fighter/Promotion, AnalyticsEvent.

-- Group C example: keep a public table explicitly readable so a global FORCE
-- can never blank it.
ALTER TABLE "Fighter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY fighter_public_read ON "Fighter" FOR SELECT USING (true);
```

## The immediate mitigation (already true today)

Every private read in the app is already owner-scoped in the query layer
(`prisma.fightPick.findMany({ where: { userId } })`, `getMyPicksForFightIds`,
notifications by `userId`, etc.). RLS is **defense-in-depth** on top of that — it
catches the day someone writes a query that *forgets* the filter. The highest-ROI
interim step, cheaper than the full RLS rollout, is a code audit that greps for
private-table `findMany`/`findFirst` without a `userId`/`authorId` in the `where`.
