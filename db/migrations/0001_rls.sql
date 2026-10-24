-- Row Level Security — defence in depth.
--
-- The API connects as `gridbox_app`, a plain NOBYPASSRLS login role, not a
-- superuser or a platform service role. That means these policies are
-- load-bearing: without them the application has no access at all.
--
-- The `service_role`, `anon` and `authenticated` policies below only exist on
-- hosted Supabase projects, which pre-create those roles. The statements are
-- therefore guarded: on a plain Postgres (Neon included) they are skipped
-- instead of aborting the migration. The application role's policies, which
-- are the ones that actually gate the game, are created unconditionally.

ALTER TABLE "gridbox"."players"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gridbox"."runs"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gridbox"."name_reports"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gridbox"."audit_log"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gridbox"."leaderboard_daily" ENABLE ROW LEVEL SECURITY;

-- The application role: full access within its own schema.
CREATE POLICY "app_all_players"           ON "gridbox"."players"           FOR ALL TO gridbox_app USING (true) WITH CHECK (true);
CREATE POLICY "app_all_runs"              ON "gridbox"."runs"              FOR ALL TO gridbox_app USING (true) WITH CHECK (true);
CREATE POLICY "app_all_name_reports"      ON "gridbox"."name_reports"      FOR ALL TO gridbox_app USING (true) WITH CHECK (true);
CREATE POLICY "app_all_audit_log"         ON "gridbox"."audit_log"         FOR ALL TO gridbox_app USING (true) WITH CHECK (true);
CREATE POLICY "app_all_leaderboard_daily" ON "gridbox"."leaderboard_daily" FOR ALL TO gridbox_app USING (true) WITH CHECK (true);

-- Service role keeps full access, in case the connection strategy changes.
-- Guarded: the role only exists on Supabase.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE POLICY "service_role_all_players"           ON "gridbox"."players"           FOR ALL TO service_role USING (true) WITH CHECK (true);
    CREATE POLICY "service_role_all_runs"              ON "gridbox"."runs"              FOR ALL TO service_role USING (true) WITH CHECK (true);
    CREATE POLICY "service_role_all_name_reports"      ON "gridbox"."name_reports"      FOR ALL TO service_role USING (true) WITH CHECK (true);
    CREATE POLICY "service_role_all_audit_log"         ON "gridbox"."audit_log"         FOR ALL TO service_role USING (true) WITH CHECK (true);
    CREATE POLICY "service_role_all_leaderboard_daily" ON "gridbox"."leaderboard_daily" FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- Public read of leaderboard data only: initials and score, never tokens or
-- hashes. Guarded for the same reason: `anon` and `authenticated` are
-- Supabase roles. On a plain Postgres nothing outside the application role can
-- reach the schema at all, which is the stricter outcome anyway.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "public_read_valid_runs"   ON "gridbox"."runs" FOR SELECT TO anon, authenticated
      USING (validity = 'ok');
    CREATE POLICY "public_read_daily_board"  ON "gridbox"."leaderboard_daily" FOR SELECT TO anon, authenticated
      USING (true);
  END IF;
END
$$;

-- Deny everything else by omission: no INSERT/UPDATE/DELETE policies exist for
-- anon or authenticated, so those operations fail closed.
