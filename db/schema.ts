import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Supabase Postgres schema.
 *
 * Every request reaches the database through the serverless API using the
 * service role, so there are no permissive policies to leak. Row Level
 * Security is enabled anyway as defence in depth: if credentials are ever
 * exposed, the policies are the second lock.
 */

export const runMode = pgEnum("run_mode", ["endless", "daily", "zen", "hardcore"]);
export const runValidity = pgEnum("run_validity", ["ok", "suspect", "rejected"]);

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** sha256 of the issued JWT. The token itself is never stored. */
    anonTokenHash: text("anon_token_hash").notNull().unique(),
    displayName: text("display_name").notNull().default("YOU"),
    initials: text("initials").notNull().default("YOU"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    totalRuns: integer("total_runs").notNull().default(0),
    bestScore: integer("best_score").notNull().default(0),
  },
  (t) => [index("players_best_score_idx").on(t.bestScore.desc())],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    mode: runMode("mode").notNull().default("endless"),
    /** Enables replay, the daily challenge and server-side verification. */
    seed: bigint("seed", { mode: "number" }).notNull(),
    day: date("day")
      .notNull()
      .default(sql`(now() at time zone 'utc')::date`),
    score: integer("score").notNull(),
    level: integer("level").notNull(),
    chips: integer("chips").notNull(),
    maxCombo: integer("max_combo").notNull(),
    kills: integer("kills").notNull(),
    durationMs: integer("duration_ms").notNull(),
    clientVersion: text("client_version").notNull(),
    /** Nonce + hash chain produced by the client's run attestation. */
    attestation: jsonb("attestation"),
    validity: runValidity("validity").notNull().default("ok"),
    /** Which scoring formula produced this run. */
    scoringVersion: integer("scoring_version").notNull().default(2),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("runs_global_idx")
      .on(t.score.desc())
      .where(sql`${t.validity} = 'ok'`),
    index("runs_mode_idx")
      .on(t.mode, t.score.desc())
      .where(sql`${t.validity} = 'ok'`),
    index("runs_daily_idx")
      .on(t.day, t.mode, t.score.desc())
      .where(sql`${t.validity} = 'ok'`),
    index("runs_player_idx").on(t.playerId, t.submittedAt.desc()),
  ],
);

/** Moderation queue for display names. */
export const nameReports = pgTable(
  "name_reports",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    reporterPlayerId: uuid("reporter_player_id").references(() => players.id, { onDelete: "set null" }),
    reportedPlayerId: uuid("reported_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    reportedName: text("reported_name").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("name_reports_status_idx").on(t.status, t.createdAt.desc())],
);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor"),
  action: text("action").notNull(),
  meta: jsonb("meta"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaderboardDaily = pgTable("leaderboard_daily", {
  day: date("day").notNull(),
  mode: runMode("mode").notNull(),
  playerId: uuid("player_id").notNull(),
  initials: text("initials").notNull(),
  score: integer("score").notNull(),
  rank: integer("rank").notNull(),
});

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
