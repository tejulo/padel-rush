CREATE TYPE "public"."category" AS ENUM('men', 'women', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."category_state" AS ENUM('draft', 'locked', 'in_progress', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('man', 'woman');--> statement-breakpoint
CREATE TYPE "public"."match_format" AS ENUM('one-set-nine', 'best-of-three');--> statement-breakpoint
CREATE TYPE "public"."match_outcome" AS ENUM('winner', 'loser');--> statement-breakpoint
CREATE TYPE "public"."match_slot" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."match_state" AS ENUM('pending', 'scheduled', 'in_progress', 'completed', 'forfeit', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tournament_state" AS ENUM('draft', 'in_progress', 'finished', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'organizer');--> statement-breakpoint
CREATE TYPE "public"."user_state" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"category" "category" NOT NULL,
	"state" "category_state" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courts" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"covered" boolean NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"ip_address" text NOT NULL,
	"successful" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"slot" "match_slot" NOT NULL,
	"team_id" text,
	"source_match_id" text,
	"source_outcome" "match_outcome",
	CONSTRAINT "match_slots_source_pair" CHECK (("match_slots"."source_match_id" is null and "match_slots"."source_outcome" is null) or ("match_slots"."source_match_id" is not null and "match_slots"."source_outcome" is not null))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"stage" text NOT NULL,
	"round" integer NOT NULL,
	"position" integer NOT NULL,
	"format" "match_format" NOT NULL,
	"state" "match_state" DEFAULT 'pending' NOT NULL,
	"court_id" text,
	"scheduled_start_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"actual_start_at" timestamp with time zone,
	"actual_end_at" timestamp with time zone,
	"score" jsonb,
	"result_reason" text,
	"winner_team_id" text,
	"loser_team_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"name" text NOT NULL,
	"gender" "gender" NOT NULL,
	"level" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_level_range" CHECK ("participants"."level" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"category_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"category_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"level_total" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"short_match_minutes" integer NOT NULL,
	"long_match_minutes" integer NOT NULL,
	"rest_minutes" integer NOT NULL,
	"state" "tournament_state" DEFAULT 'draft' NOT NULL,
	"public_token" text,
	"organizer_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_short_match_minutes_positive" CHECK ("tournaments"."short_match_minutes" > 0),
	CONSTRAINT "tournaments_long_match_minutes_positive" CHECK ("tournaments"."long_match_minutes" > 0),
	CONSTRAINT "tournaments_rest_minutes_nonnegative" CHECK ("tournaments"."rest_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"state" "user_state" DEFAULT 'active' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_slots" ADD CONSTRAINT "match_slots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_slots" ADD CONSTRAINT "match_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_slots" ADD CONSTRAINT "match_slots_source_match_id_matches_id_fk" FOREIGN KEY ("source_match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_loser_team_id_teams_id_fk" FOREIGN KEY ("loser_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_tournament_category_unique" ON "categories" USING btree ("tournament_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "courts_tournament_name_unique" ON "courts" USING btree ("tournament_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "match_slots_match_slot_unique" ON "match_slots" USING btree ("match_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_category_stage_round_position_unique" ON "matches" USING btree ("category_id","stage","round","position");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_participant_category_unique" ON "registrations" USING btree ("participant_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_participant_unique" ON "team_members" USING btree ("team_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_participant_category_unique" ON "team_members" USING btree ("participant_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_public_token_unique" ON "tournaments" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");