CREATE TABLE "gridbox"."legacy_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"score" integer NOT NULL,
	"level" integer NOT NULL,
	"chips" integer NOT NULL,
	"max_combo" integer NOT NULL,
	"played_at" bigint NOT NULL,
	"scoring_version" integer DEFAULT 1 NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gridbox"."legacy_scores" ADD CONSTRAINT "legacy_scores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "gridbox"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_scores_player_client_idx" ON "gridbox"."legacy_scores" USING btree ("player_id","client_id");--> statement-breakpoint
CREATE INDEX "legacy_scores_player_idx" ON "gridbox"."legacy_scores" USING btree ("player_id","score" DESC NULLS LAST);