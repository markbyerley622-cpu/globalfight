-- ============================================================================
--  RLS verification — run AS the non-owner app role (app_rw) after applying
--  prisma/rls/policies.sql in staging. Every assertion raises if it fails, so
--  a clean run printing "RLS VERIFY: all assertions passed" is the go signal.
--
--  Usage (staging):
--    PGPASSWORD=… psql -U app_rw -d <staging_db> -v ON_ERROR_STOP=1 -f verify.sql
--
--  The logic mirrors the sandbox proof used during the red-team pass: a role
--  with app.user_id = userA must see only userA's private rows, an unset user
--  must see none, and public tables must stay readable regardless.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  a_only int;
  cross_leak int;
  anon_private int;
  anon_public int;
BEGIN
  -- Pick any two distinct real user ids present in the DB.
  PERFORM set_config('app.user_id', (SELECT id FROM "User" ORDER BY "createdAt" LIMIT 1), false);

  -- 1. As a real user, every private row I can see must be mine.
  SELECT count(*) INTO cross_leak FROM "Notification"
    WHERE "userId" <> current_setting('app.user_id', true);
  IF cross_leak <> 0 THEN
    RAISE EXCEPTION 'RLS FAIL: Notification leaked % rows belonging to other users', cross_leak;
  END IF;

  SELECT count(*) INTO cross_leak FROM "FightPick"
    WHERE "userId" <> current_setting('app.user_id', true);
  IF cross_leak <> 0 THEN
    RAISE EXCEPTION 'RLS FAIL: FightPick leaked % rows belonging to other users', cross_leak;
  END IF;

  SELECT count(*) INTO cross_leak FROM "CheckIn"
    WHERE "userId" <> current_setting('app.user_id', true);
  IF cross_leak <> 0 THEN
    RAISE EXCEPTION 'RLS FAIL: CheckIn (location!) leaked % rows', cross_leak;
  END IF;

  -- 2. An explicit IDOR filter for someone else must still return nothing.
  SELECT count(*) INTO cross_leak FROM "Notification"
    WHERE "userId" = (SELECT id FROM "User" WHERE id <> current_setting('app.user_id', true) LIMIT 1);
  IF cross_leak <> 0 THEN
    RAISE EXCEPTION 'RLS FAIL: explicit cross-user Notification filter returned % rows', cross_leak;
  END IF;

  -- 3. Anonymous (no user set): private tables empty, public still readable.
  PERFORM set_config('app.user_id', '', false);
  SELECT count(*) INTO anon_private FROM "FightPick";
  IF anon_private <> 0 THEN
    RAISE EXCEPTION 'RLS FAIL: anonymous saw % FightPick rows', anon_private;
  END IF;
  SELECT count(*) INTO anon_public FROM "Fighter";
  IF anon_public = 0 THEN
    RAISE EXCEPTION 'RLS FAIL: public Fighter table blanked for anonymous — policy too strict';
  END IF;

  RAISE NOTICE 'RLS VERIFY: all assertions passed';
END $$;
