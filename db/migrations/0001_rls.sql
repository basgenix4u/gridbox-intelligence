-- Row Level Security — defence in depth.
--
-- Every request reaches Postgres through the serverless API using the service
-- role, which bypasses RLS. These policies exist for the case where a key is
-- ever exposed or a Supabase client is used directly: they ensure the anon and
-- authenticated roles can read public leaderboard data but cannot insert,
-- update or delete runs. There are deliberately no write policies.

ALTER TABLE "players"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runs"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "name_reports"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leaderboard_daily" ENABLE ROW LEVEL SECURITY;

-- Service role keeps full access for the API.
CREATE POLICY "service_role_all_players" ON "players" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_runs" ON "runs" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_name_reports" ON "name_reports" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_audit_log" ON "audit_log" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_leaderboard_daily" ON "leaderboard_daily" FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read of the leaderboard only: initials and score, never tokens or hashes.
CREATE POLICY "public_read_valid_runs" ON "runs" FOR SELECT TO anon, authenticated
  USING (validity = 'ok');

CREATE POLICY "public_read_daily_board" ON "leaderboard_daily" FOR SELECT TO anon, authenticated
  USING (true);

-- Deny everything else by omission: no INSERT/UPDATE/DELETE policies exist for
-- anon or authenticated, so those operations fail closed.
