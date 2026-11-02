DROP INDEX "workout_plan_items_position_key";--> statement-breakpoint
ALTER TABLE "workout_plan_items" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_plan_items_position_key" ON "workout_plan_items" USING btree ("plan_id","day_number","position") WHERE "workout_plan_items"."removed_at" is null;