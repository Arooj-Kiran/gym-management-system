CREATE TYPE "public"."difficulty_level" AS ENUM('BEGINNER', 'INTERMEDIATE', 'ADVANCED');--> statement-breakpoint
CREATE TYPE "public"."muscle_group" AS ENUM('CHEST', 'BACK', 'SHOULDERS', 'ARMS', 'LEGS', 'GLUTES', 'CORE', 'FULL_BODY', 'CARDIO');--> statement-breakpoint
CREATE TYPE "public"."workout_assignment_status" AS ENUM('ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."workout_plan_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."equipment_category" AS ENUM('CARDIO', 'STRENGTH_MACHINE', 'FREE_WEIGHTS', 'FUNCTIONAL', 'ACCESSORY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."equipment_condition" AS ENUM('EXCELLENT', 'GOOD', 'FAIR', 'POOR');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('PREVENTIVE', 'REPAIR', 'INSPECTION');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('NOT_CONFIGURED', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL', 'SMS', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('MEMBERSHIP_EXPIRING', 'MEMBERSHIP_EXPIRED', 'MEMBERSHIP_CANCELLED', 'MEMBERSHIP_SUSPENDED', 'PAYMENT_DUE', 'PAYMENT_OVERDUE', 'RENEWAL_SUCCESS', 'CLASS_REMINDER', 'APPOINTMENT_REMINDER', 'EQUIPMENT_MAINTENANCE_DUE', 'BIOMETRIC_RETENTION_DUE');--> statement-breakpoint
CREATE SEQUENCE "public"."equipment_tag_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "citext" NOT NULL,
	"description" varchar(1000),
	"muscle_group" "muscle_group" NOT NULL,
	"difficulty" "difficulty_level" NOT NULL,
	"instructions" varchar(2000),
	"equipment_needed" varchar(200),
	"image_key" varchar(120),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_name_length" CHECK (char_length("exercises"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "progress_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"recorded_on" date NOT NULL,
	"weight_kg" numeric(4, 1),
	"body_fat_pct" numeric(3, 1),
	"measurements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" varchar(500),
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_entries_weight" CHECK ("progress_entries"."weight_kg" is null or "progress_entries"."weight_kg" between 20 and 400),
	CONSTRAINT "progress_entries_body_fat" CHECK ("progress_entries"."body_fat_pct" is null or "progress_entries"."body_fat_pct" between 2 and 70),
	CONSTRAINT "progress_entries_measurement_keys" CHECK (jsonb_typeof("progress_entries"."measurements") = 'object'
        and "progress_entries"."measurements" - array['chest', 'waist', 'hips', 'arm', 'thigh'] = '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "workout_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"trainer_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "workout_assignment_status" DEFAULT 'ACTIVE' NOT NULL,
	"trainer_notes" varchar(500),
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_assignments_range" CHECK ("workout_assignments"."end_date" is null or "workout_assignments"."end_date" >= "workout_assignments"."start_date")
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_item_id" uuid,
	"performed_on" date NOT NULL,
	"completed" boolean NOT NULL,
	"actual_sets" smallint,
	"actual_reps" smallint,
	"actual_load" varchar(60),
	"actual_duration_seconds" smallint,
	"notes" varchar(500),
	"logged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_logs_actuals" CHECK (coalesce("workout_logs"."actual_sets", 0) between 0 and 20 and coalesce("workout_logs"."actual_reps", 0) between 0 and 100
        and coalesce("workout_logs"."actual_duration_seconds", 0) between 0 and 7200)
);
--> statement-breakpoint
CREATE TABLE "workout_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"day_number" smallint NOT NULL,
	"position" smallint NOT NULL,
	"sets" smallint NOT NULL,
	"reps" smallint,
	"duration_seconds" smallint,
	"rest_seconds" smallint DEFAULT 60 NOT NULL,
	"load_note" varchar(60),
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_plan_items_day" CHECK ("workout_plan_items"."day_number" between 1 and 7),
	CONSTRAINT "workout_plan_items_position" CHECK ("workout_plan_items"."position" >= 1),
	CONSTRAINT "workout_plan_items_sets" CHECK ("workout_plan_items"."sets" between 1 and 20),
	CONSTRAINT "workout_plan_items_reps" CHECK ("workout_plan_items"."reps" is null or "workout_plan_items"."reps" between 1 and 100),
	CONSTRAINT "workout_plan_items_duration" CHECK ("workout_plan_items"."duration_seconds" is null or "workout_plan_items"."duration_seconds" between 1 and 7200),
	CONSTRAINT "workout_plan_items_rest" CHECK ("workout_plan_items"."rest_seconds" between 0 and 600),
	CONSTRAINT "workout_plan_items_reps_or_duration" CHECK ("workout_plan_items"."reps" is not null or "workout_plan_items"."duration_seconds" is not null)
);
--> statement-breakpoint
CREATE TABLE "workout_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(1000),
	"goal" varchar(200),
	"difficulty" "difficulty_level" NOT NULL,
	"owner_trainer_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"status" "workout_plan_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_tag" varchar(16) DEFAULT 'EQ-' || lpad(nextval('equipment_tag_seq')::text, 6, '0') NOT NULL,
	"name" varchar(80) NOT NULL,
	"category" "equipment_category" NOT NULL,
	"brand" varchar(80),
	"model" varchar(80),
	"serial_number" "citext",
	"location" varchar(80),
	"purchase_date" date,
	"purchase_cost_minor" bigint,
	"condition" "equipment_condition" DEFAULT 'GOOD' NOT NULL,
	"status" "equipment_status" DEFAULT 'IN_SERVICE' NOT NULL,
	"out_of_service_reason" varchar(500),
	"maintenance_interval_days" smallint,
	"next_maintenance_date" date,
	"notes" varchar(1000),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_purchase_cost" CHECK ("equipment"."purchase_cost_minor" is null or "equipment"."purchase_cost_minor" >= 0),
	CONSTRAINT "equipment_interval" CHECK ("equipment"."maintenance_interval_days" is null or "equipment"."maintenance_interval_days" between 1 and 730),
	CONSTRAINT "equipment_out_of_service_reason" CHECK (("equipment"."status" = 'IN_SERVICE') = ("equipment"."out_of_service_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"type" "maintenance_type" NOT NULL,
	"performed_on" date NOT NULL,
	"performed_by_name" varchar(80),
	"cost_minor" bigint,
	"description" varchar(1000) NOT NULL,
	"repair_notes" varchar(1000),
	"condition_after" "equipment_condition" NOT NULL,
	"next_maintenance_date" date,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_records_cost" CHECK ("maintenance_records"."cost_minor" is null or "maintenance_records"."cost_minor" >= 0),
	CONSTRAINT "maintenance_records_next_date" CHECK ("maintenance_records"."next_maintenance_date" is null or "maintenance_records"."next_maintenance_date" > "maintenance_records"."performed_on")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "delivery_status" NOT NULL,
	"provider_message_id" varchar(200),
	"error_code" varchar(60),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_outcome" CHECK (("notification_deliveries"."status" = 'SENT') = ("notification_deliveries"."provider_message_id" is not null)
        and ("notification_deliveries"."status" = 'FAILED') = ("notification_deliveries"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" varchar(500) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_entity" CHECK (("notifications"."entity_type" is null) = ("notifications"."entity_id" is null))
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_assignments" ADD CONSTRAINT "workout_assignments_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_assignments" ADD CONSTRAINT "workout_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_assignments" ADD CONSTRAINT "workout_assignments_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_assignments" ADD CONSTRAINT "workout_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_assignment_id_workout_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workout_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_item_id_workout_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."workout_plan_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plan_items" ADD CONSTRAINT "workout_plan_items_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_owner_trainer_id_users_id_fk" FOREIGN KEY ("owner_trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_name_key" ON "exercises" USING btree ("name");--> statement-breakpoint
CREATE INDEX "exercises_name_trgm_idx" ON "exercises" USING gin (("name"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "exercises_muscle_difficulty_idx" ON "exercises" USING btree ("muscle_group","difficulty");--> statement-breakpoint
CREATE INDEX "progress_entries_member_recorded_idx" ON "progress_entries" USING btree ("member_id","recorded_on" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "workout_assignments_open_key" ON "workout_assignments" USING btree ("member_id","plan_id") WHERE "workout_assignments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "workout_assignments_member_idx" ON "workout_assignments" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "workout_assignments_plan_idx" ON "workout_assignments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "workout_assignments_trainer_idx" ON "workout_assignments" USING btree ("trainer_id");--> statement-breakpoint
CREATE INDEX "workout_logs_member_performed_idx" ON "workout_logs" USING btree ("member_id","performed_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workout_logs_assignment_idx" ON "workout_logs" USING btree ("assignment_id","performed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_logs_item_day_key" ON "workout_logs" USING btree ("assignment_id","plan_item_id","performed_on") WHERE "workout_logs"."plan_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_plan_items_position_key" ON "workout_plan_items" USING btree ("plan_id","day_number","position");--> statement-breakpoint
CREATE INDEX "workout_plan_items_exercise_idx" ON "workout_plan_items" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_plans_owner_idx" ON "workout_plans" USING btree ("owner_trainer_id","status");--> statement-breakpoint
CREATE INDEX "workout_plans_name_trgm_idx" ON "workout_plans" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_asset_tag_key" ON "equipment" USING btree ("asset_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_serial_number_key" ON "equipment" USING btree ("serial_number") WHERE "equipment"."serial_number" is not null;--> statement-breakpoint
CREATE INDEX "equipment_status_idx" ON "equipment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "equipment_next_maintenance_idx" ON "equipment" USING btree ("next_maintenance_date");--> statement-breakpoint
CREATE INDEX "equipment_name_trgm_idx" ON "equipment" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "maintenance_records_equipment_idx" ON "maintenance_records" USING btree ("equipment_id","performed_on" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_channel_key" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_attempted_idx" ON "notification_deliveries" USING btree ("attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","read_at","created_at" DESC NULLS LAST);