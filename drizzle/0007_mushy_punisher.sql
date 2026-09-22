CREATE TYPE "public"."match_profile" AS ENUM('regular', 'finals');--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "profile" "match_profile";--> statement-breakpoint
UPDATE "matches" SET "profile" = CASE WHEN "format" = 'best-of-three' THEN 'finals'::"match_profile" ELSE 'regular'::"match_profile" END;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "profile" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "format";--> statement-breakpoint
DROP TYPE "public"."match_format";
