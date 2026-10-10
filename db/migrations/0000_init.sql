CREATE TYPE "public"."run_mode" AS ENUM('endless', 'daily', 'zen', 'hardcore');--> statement-breakpoint
CREATE TYPE "public"."run_validity" AS ENUM('ok', 'suspect', 'rejected');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_daily" (
	"day" date NOT NULL,
	"mode" "run_mode" NOT NULL,
	"player_id" uuid NOT NULL,
	"initials" text NOT NULL,
	"score" integer NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "name_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reporter_player_id" uuid,
	"reported_player_id" uuid NOT NULL,
	"reported_name" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anon_token_hash" text NOT NULL,
	"display_name" text DEFAULT 'YOU' NOT NULL,
	"initials" text DEFAULT 'YOU' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "players_anon_token_hash_unique" UNIQUE("anon_token_hash")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"mode" "run_mode" DEFAULT 'endless' NOT NULL,
	"seed" bigint NOT NULL,
	"day" date DEFAULT (now() at time zone 'utc')::date NOT NULL,
	"score" integer NOT NULL,
	"level" integer NOT NULL,
	"chips" integer NOT NULL,
	"max_combo" integer NOT NULL,
	"kills" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"client_version" text NOT NULL,
	"attestation" jsonb,
	"validity" "run_validity" DEFAULT 'ok' NOT NULL,
	"scoring_version" integer DEFAULT 2 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "name_reports" ADD CONSTRAINT "name_reports_reporter_player_id_players_id_fk" FOREIGN KEY ("reporter_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_reports" ADD CONSTRAINT "name_reports_reported_player_id_players_id_fk" FOREIGN KEY ("reported_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "name_reports_status_idx" ON "name_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "players_best_score_idx" ON "players" USING btree ("best_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_global_idx" ON "runs" USING btree ("score" DESC NULLS LAST) WHERE "runs"."validity" = 'ok';--> statement-breakpoint
CREATE INDEX "runs_mode_idx" ON "runs" USING btree ("mode","score" DESC NULLS LAST) WHERE "runs"."validity" = 'ok';--> statement-breakpoint
CREATE INDEX "runs_daily_idx" ON "runs" USING btree ("day","mode","score" DESC NULLS LAST) WHERE "runs"."validity" = 'ok';--> statement-breakpoint
CREATE INDEX "runs_player_idx" ON "runs" USING btree ("player_id","submitted_at" DESC NULLS LAST);