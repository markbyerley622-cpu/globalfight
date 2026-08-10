-- ============================================================================
--  Row-Level Security policies — defense-in-depth for owner-private tables.
--
--  STATUS: reviewable + sandbox-proven, NOT yet applied to production. See
--  docs/SECURITY-RLS.md for why this is staged, not toggled. The short version:
--  the app connects as the table OWNER, and `FORCE ROW LEVEL SECURITY` makes
--  even the owner subject to policy — so applying this while the app still
--  connects as owner WITHOUT the per-request `app.user_id` set (the Prisma
--  session-context extension) turns every private read into an empty result:
--  a silent, sitewide data-disappearance outage.
--
--  ACTIVATION ORDER (all in staging first):
--    1. Create a non-superuser role `app_rw`; GRANT DML per table; point
--       DATABASE_URL at it.
--    2. Ship the session-context extension (src/lib/db-rls.ts) behind
--       RLS_SESSION_CONTEXT=1 so `app.user_id` is SET LOCAL on every request.
--    3. Apply this file. Run the full test suite + the checks in
--       prisma/rls/verify.sql. Confirm: cross-user private reads return nothing;
--       public pages still render anonymously.
--    4. Repeat in production off-peak, with `ALTER TABLE … DISABLE ROW LEVEL
--       SECURITY` as the tested rollback.
--
--  The current, ALREADY-ACTIVE control is application-layer: every private read
--  is owner-scoped (`where: { userId }`). RLS catches the day a query forgets
--  that filter — it does not replace it.
-- ============================================================================

-- Helper: current request's user id, NULL when unset. The `true` second arg
-- means "missing setting is not an error" — an unauthenticated request simply
-- has no user id, and every owner policy then matches zero rows.
--   current_setting('app.user_id', true)

-- ── Group A — owner-only reads AND writes ──────────────────────────────────
-- A row is visible/mutable only to the user who owns it.

ALTER TABLE "Notification"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY notif_owner       ON "Notification"      USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "FightPick"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FightPick"         FORCE  ROW LEVEL SECURITY;
-- Individual picks are private; the per-fight crowd tally is computed server-side
-- (counts/aggregates), never by exposing another user's pick rows.
CREATE POLICY pick_owner        ON "FightPick"         USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "Session"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"           FORCE  ROW LEVEL SECURITY;
CREATE POLICY session_owner     ON "Session"           USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "Account"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"           FORCE  ROW LEVEL SECURITY;
CREATE POLICY account_owner     ON "Account"           USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "PushSubscription"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription"  FORCE  ROW LEVEL SECURITY;
CREATE POLICY push_owner        ON "PushSubscription"  USING ("userId" = current_setting('app.user_id', true));

-- CheckIn is location data — the most sensitive owner-private table.
ALTER TABLE "CheckIn"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckIn"           FORCE  ROW LEVEL SECURITY;
CREATE POLICY checkin_owner     ON "CheckIn"           USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "ForumBookmark"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForumBookmark"     FORCE  ROW LEVEL SECURITY;
CREATE POLICY bookmark_owner    ON "ForumBookmark"     USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "ForumSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForumSubscription" FORCE  ROW LEVEL SECURITY;
CREATE POLICY sub_owner         ON "ForumSubscription" USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "FavoriteFighter"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FavoriteFighter"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY favfighter_owner  ON "FavoriteFighter"   USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "FavoritePromotion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FavoritePromotion" FORCE  ROW LEVEL SECURITY;
CREATE POLICY favpromo_owner    ON "FavoritePromotion" USING ("userId" = current_setting('app.user_id', true));

ALTER TABLE "FavoriteEvent"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FavoriteEvent"     FORCE  ROW LEVEL SECURITY;
CREATE POLICY favevent_owner    ON "FavoriteEvent"     USING ("userId" = current_setting('app.user_id', true));

-- UserFollow: the follower owns the edge (who *I* follow is mine to manage).
-- Reads of "who follows X" are served by server-side counts, not row exposure.
ALTER TABLE "UserFollow"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserFollow"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY follow_owner      ON "UserFollow"        USING ("followerId" = current_setting('app.user_id', true));

-- UserBlock: the BLOCKER owns the row — it records their decision, and the
-- blocked party is never told it exists.
--
-- ⚠ THE ONE TABLE IN GROUP A WHOSE POLICY IS NOT A PLAIN OWNER MATCH. Blocking
-- is stored one-directionally and ENFORCED symmetrically, so the hot predicate
-- (`blockExistsBetween`) has to see rows where the viewer is the blockedId —
-- rows they do not own. A `USING ("blockerId" = …)` policy alone would make
-- every reverse-leg check return false under RLS, which fails OPEN: the blocked
-- person could message and follow again and nothing would error. Both legs are
-- therefore visible, which is safe because the row carries no content — only
-- two ids the viewer is already one half of.
ALTER TABLE "UserBlock"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserBlock"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY block_party       ON "UserBlock"
  USING ("blockerId" = current_setting('app.user_id', true)
      OR "blockedId" = current_setting('app.user_id', true));
-- WRITES are blocker-only: being blocked must not let you delete the block.
CREATE POLICY block_write       ON "UserBlock" FOR ALL
  USING ("blockerId" = current_setting('app.user_id', true))
  WITH CHECK ("blockerId" = current_setting('app.user_id', true));

ALTER TABLE "AnalyticsEvent"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsEvent"    FORCE  ROW LEVEL SECURITY;
CREATE POLICY analytics_owner   ON "AnalyticsEvent"    USING ("userId" = current_setting('app.user_id', true));

-- PasswordResetToken: no user ever reads it (server matches by token hash only).
-- No permissive policy → with FORCE on, only a BYPASSRLS job can read it.
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE  ROW LEVEL SECURITY;

-- ── Group C — public content, kept explicitly readable ─────────────────────
-- These are world-readable by design. An explicit permissive SELECT policy is a
-- guard rail: if someone later runs a blanket `FORCE ROW LEVEL SECURITY` across
-- every table, these do NOT silently blank the public site. Writes stay guarded
-- at the app layer (+ rate limits); RLS here is read-permissive only.
ALTER TABLE "Fighter"    ENABLE ROW LEVEL SECURITY;  CREATE POLICY fighter_public_read    ON "Fighter"    FOR SELECT USING (true);
ALTER TABLE "Event"      ENABLE ROW LEVEL SECURITY;  CREATE POLICY event_public_read      ON "Event"      FOR SELECT USING (true);
ALTER TABLE "Fight"      ENABLE ROW LEVEL SECURITY;  CREATE POLICY fight_public_read      ON "Fight"      FOR SELECT USING (true);
ALTER TABLE "Ranking"    ENABLE ROW LEVEL SECURITY;  CREATE POLICY ranking_public_read    ON "Ranking"    FOR SELECT USING (true);
ALTER TABLE "Gym"        ENABLE ROW LEVEL SECURITY;  CREATE POLICY gym_public_read        ON "Gym"        FOR SELECT USING (true);
ALTER TABLE "GymReview"  ENABLE ROW LEVEL SECURITY;  CREATE POLICY gymreview_public_read  ON "GymReview"  FOR SELECT USING (true);
