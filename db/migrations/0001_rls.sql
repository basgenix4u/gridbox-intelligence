-- Row Level Security — defence in depth.
--
-- The API connects as `gridbox_app`, a plain NOBYPASSRLS login role, not
-- Supabase's `service_role`. That means these policies are load-bearing:
-- without them the application has no access at all.
--
-- Policies are also declared for `service_role` and for public read, so the
-- rules stay correct if the connection strategy ever changes. Note that the
-- `gridbox` schema is deliberately NOT exposed over PostgREST, so `anon` and
-- `authenticated` cannot reach it regardless.

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
CREATE POLICY "service_role_all_players"           ON "gridbox"."players"           FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_runs"              ON "gridbox"."runs"              FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_name_reports"      ON "gridbox"."name_reports"      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_audit_log"         ON "gridbox"."audit_log"         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_leaderboard_daily" ON "gridbox"."leaderboard_daily" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read of leaderboard data only: initials and score, never tokens or hashes.
CREATE POLICY "public_read_valid_runs"   ON "gridbox"."runs" FOR SELECT TO anon, authenticated
  USING (validity = 'ok');
CREATE POLICY "public_read_daily_board"  ON "gridbox"."leaderboard_daily" FOR SELECT TO anon, authenticated
  USING (true);

-- Deny everything else by omission: no INSERT/UPDATE/DELETE policies exist for
-- anon or authenticated, so those operations fail closed.
