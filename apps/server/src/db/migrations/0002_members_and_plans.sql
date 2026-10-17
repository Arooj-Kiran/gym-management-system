CREATE TYPE "public"."member_account_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."duration_unit" AS ENUM('DAY', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('MONTHLY', 'QUARTERLY', 'SIX_MONTH', 'ANNUAL', 'CUSTOM');--> statement-breakpoint
CREATE SEQUENCE "public"."member_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_code" varchar(16) DEFAULT 'GM-' || lpad(nextval('member_code_seq')::text, 6, '0') NOT NULL,
	"user_id" uuid,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"email" "citext",
	"phone_e164" varchar(16) NOT NULL,
	"profile_photo_key" varchar(200),
	"emergency_contact_name" varchar(80),
	"emergency_contact_phone" varchar(16),
	"emergency_contact_relation" varchar(40),
	"registration_date" date NOT NULL,
	"notes" text,
	"account_status" "member_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"access_blocked" boolean DEFAULT false NOT NULL,
	"access_block_reason" varchar(500),
	"access_blocked_at" timestamp with time zone,
	"access_blocked_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_first_name_length" CHECK (char_length("members"."first_name") between 1 and 80),
	CONSTRAINT "members_last_name_length" CHECK (char_length("members"."last_name") between 1 and 80),
	CONSTRAINT "members_email_length" CHECK ("members"."email" is null or char_length("members"."email") between 3 and 254),
	CONSTRAINT "members_phone_e164" CHECK ("members"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "members_emergency_phone_e164" CHECK ("members"."emergency_contact_phone" is null or "members"."emergency_contact_phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "members_notes_length" CHECK ("members"."notes" is null or char_length("members"."notes") <= 2000),
	CONSTRAINT "members_access_block_consistent" CHECK ("members"."access_blocked" = ("members"."access_blocked_at" is not null)),
	CONSTRAINT "members_archive_consistent" CHECK (("members"."archived_at" is null) = ("members"."archived_by" is null))
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"plan_type" "plan_type" NOT NULL,
	"duration_value" integer NOT NULL,
	"duration_unit" "duration_unit" NOT NULL,
	"price_minor" bigint NOT NULL,
	"description" text,
	"benefits" text[] DEFAULT '{}'::text[] NOT NULL,
	"allow_partial_payment" boolean DEFAULT false NOT NULL,
	"access_days" smallint[],
	"access_start_time" time,
	"access_end_time" time,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_name_length" CHECK (char_length("membership_plans"."name") between 2 and 80),
	CONSTRAINT "membership_plans_price_non_negative" CHECK ("membership_plans"."price_minor" >= 0),
	CONSTRAINT "membership_plans_duration_positive" CHECK ("membership_plans"."duration_value" > 0),
	CONSTRAINT "membership_plans_duration_matches_type" CHECK (case "membership_plans"."plan_type"
        when 'MONTHLY' then "membership_plans"."duration_unit" = 'MONTH' and "membership_plans"."duration_value" = 1
        when 'QUARTERLY' then "membership_plans"."duration_unit" = 'MONTH' and "membership_plans"."duration_value" = 3
        when 'SIX_MONTH' then "membership_plans"."duration_unit" = 'MONTH' and "membership_plans"."duration_value" = 6
        when 'ANNUAL' then "membership_plans"."duration_unit" = 'MONTH' and "membership_plans"."duration_value" = 12
        else true end),
	CONSTRAINT "membership_plans_description_length" CHECK ("membership_plans"."description" is null or char_length("membership_plans"."description") <= 2000),
	CONSTRAINT "membership_plans_access_days_valid" CHECK ("membership_plans"."access_days" is null or (cardinality("membership_plans"."access_days") between 1 and 7 and "membership_plans"."access_days" <@ array[1,2,3,4,5,6,7]::smallint[])),
	CONSTRAINT "membership_plans_access_hours_valid" CHECK (("membership_plans"."access_start_time" is null and "membership_plans"."access_end_time" is null) or ("membership_plans"."access_start_time" is not null and "membership_plans"."access_end_time" is not null and "membership_plans"."access_start_time" < "membership_plans"."access_end_time"))
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_access_blocked_by_users_id_fk" FOREIGN KEY ("access_blocked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_member_code_key" ON "members" USING btree ("member_code");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_id_key" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_active_key" ON "members" USING btree (lower("email")) WHERE "members"."archived_at" is null and "members"."email" is not null;--> statement-breakpoint
CREATE INDEX "members_phone_active_idx" ON "members" USING btree ("phone_e164") WHERE "members"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "members_registration_date_idx" ON "members" USING btree ("registration_date");--> statement-breakpoint
CREATE INDEX "members_account_status_idx" ON "members" USING btree ("account_status");--> statement-breakpoint
CREATE INDEX "members_name_trgm_idx" ON "members" USING gin (("first_name" || ' ' || "last_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "members_email_trgm_idx" ON "members" USING gin (("email"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "members_phone_trgm_idx" ON "members" USING gin ("phone_e164" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_name_key" ON "membership_plans" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "membership_plans_active_idx" ON "membership_plans" USING btree ("is_active");