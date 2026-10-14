CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'MANAGER', 'RECEPTIONIST', 'TRAINER', 'MEMBER');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"phone" varchar(16),
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_length" CHECK (char_length("users"."email") between 3 and 254),
	CONSTRAINT "users_first_name_length" CHECK (char_length("users"."first_name") between 1 and 80),
	CONSTRAINT "users_last_name_length" CHECK (char_length("users"."last_name") between 1 and 80),
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" is null or "users"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "users_failed_login_count_non_negative" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_title" varchar(80),
	"hire_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_notes_length" CHECK ("staff_profiles"."notes" is null or char_length("staff_profiles"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role",
	"action" varchar(64) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_name" varchar(120) DEFAULT 'My Gym' NOT NULL,
	"expiry_reminder_days" integer DEFAULT 7 NOT NULL,
	"payment_due_reminder_days" integer DEFAULT 3 NOT NULL,
	"invoice_due_days" integer DEFAULT 0 NOT NULL,
	"biometric_retention_days" integer DEFAULT 30 NOT NULL,
	"class_booking_cutoff_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_settings_gym_name_length" CHECK (char_length("gym_settings"."gym_name") between 1 and 120),
	CONSTRAINT "gym_settings_expiry_reminder_days" CHECK ("gym_settings"."expiry_reminder_days" between 1 and 60),
	CONSTRAINT "gym_settings_payment_due_reminder_days" CHECK ("gym_settings"."payment_due_reminder_days" between 0 and 30),
	CONSTRAINT "gym_settings_invoice_due_days" CHECK ("gym_settings"."invoice_due_days" between 0 and 60),
	CONSTRAINT "gym_settings_biometric_retention_days" CHECK ("gym_settings"."biometric_retention_days" between 1 and 365),
	CONSTRAINT "gym_settings_class_booking_cutoff_minutes" CHECK ("gym_settings"."class_booking_cutoff_minutes" between 0 and 1440)
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_active_user_idx" ON "user_sessions" USING btree ("user_id") WHERE "user_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");