-- The daily rollup describes the run that set each player's best score of the
-- day, so it has to carry that run's level. `LeaderboardRowSchema` has always
-- required `level`; the daily board was answering 0 for every row because the
-- column did not exist and the mapper defaulted it.
--
-- Existing rows predate the column and cannot be backfilled from
-- `leaderboard_daily` alone — it stores a score, not a run id. They keep the
-- default 0, which is what they were already reporting, so nothing regresses.
-- New rows are written with the level of the run being folded in.
ALTER TABLE "gridbox"."leaderboard_daily" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 0 NOT NULL;
