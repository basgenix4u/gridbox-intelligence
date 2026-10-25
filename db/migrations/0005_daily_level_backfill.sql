-- Backfill `leaderboard_daily.level` from the run that set each best score.
--
-- Migration 0004 added the column and stated that existing rows could not be
-- recovered "from `leaderboard_daily` alone — it stores a score, not a run id".
-- That is true of the rollup, but not of `runs`: every submitted run keeps its
-- own `day`, `mode`, `player_id`, `score` and `level`, and the rollup's score is
-- by definition the best run of that day. So the level can be recovered exactly
-- by joining on the matching best run.
--
-- Without this, a player whose daily best predates 0004 is shown at level 0 on
-- the daily board while the global board correctly shows the level of the very
-- same run. The two boards disagree about one player's run, which reads as a
-- bug in the board rather than as old data.
--
-- The join is deliberately narrow: only rows whose stored score still matches
-- the best run for that (day, mode, player) are touched, and only those still
-- reporting 0. A row whose score was superseded keeps whatever it has, because
-- there is no longer a run that explains it.

UPDATE "gridbox"."leaderboard_daily" AS d
SET "level" = best."level"
FROM (
  SELECT DISTINCT ON (r."player_id", r."day", r."mode")
         r."player_id",
         r."day",
         r."mode",
         r."score",
         r."level"
  FROM "gridbox"."runs" AS r
  ORDER BY r."player_id", r."day", r."mode", r."score" DESC, r."submitted_at" DESC
) AS best
WHERE d."player_id" = best."player_id"
  AND d."day" = best."day"
  AND d."mode" = best."mode"
  AND d."score" = best."score"
  AND d."level" = 0;
