CREATE TYPE "public"."membership_event_type" AS ENUM('CREATED', 'ACTIVATED', 'RENEWED', 'EXTENDED', 'SUSPENDED', 'REACTIVATED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"event_type" "membership_event_type" NOT NULL,
	"from_status" "membership_status",
	"to_status" "membership_status" NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_name_snapshot" varchar(80) NOT NULL,
	"price_minor_snapshot" bigint NOT NULL,
	"access_days_snapshot" smallint[],
	"access_start_time_snapshot" time,
	"access_end_time_snapshot" time,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "membership_status" DEFAULT 'PENDING' NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by" uuid,
	"suspended_at" timestamp with time zone,
	"suspension_reason" varchar(500),
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" varchar(500),
	"total_suspended_days" integer DEFAULT 0 NOT NULL,
	"renewed_from_id" uuid,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_dates_ordered" CHECK ("memberships"."end_date" >= "memberships"."start_date"),
	CONSTRAINT "memberships_price_non_negative" CHECK ("memberships"."price_minor_snapshot" >= 0),
	CONSTRAINT "memberships_suspended_days_non_negative" CHECK ("memberships"."total_suspended_days" >= 0),
	CONSTRAINT "memberships_version_positive" CHECK ("memberships"."version" > 0),
	CONSTRAINT "memberships_not_renewed_from_self" CHECK ("memberships"."renewed_from_id" <> "memberships"."id"),
	CONSTRAINT "memberships_activation_recorded" CHECK ("memberships"."status" not in ('ACTIVE', 'SUSPENDED', 'EXPIRED') or "memberships"."activated_at" is not null),
	CONSTRAINT "memberships_suspension_consistent" CHECK (("memberships"."status" = 'SUSPENDED') = ("memberships"."suspended_at" is not null)),
	CONSTRAINT "memberships_cancellation_consistent" CHECK (("memberships"."status" = 'CANCELLED') = ("memberships"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_events" ADD CONSTRAINT "membership_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_renewed_from_id_fk" FOREIGN KEY ("renewed_from_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_events_membership_created_idx" ON "membership_events" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_events_member_created_idx" ON "membership_events" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_events_type_created_idx" ON "membership_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "memberships_member_start_idx" ON "memberships" USING btree ("member_id","start_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memberships_status_end_idx" ON "memberships" USING btree ("status","end_date");--> statement-breakpoint
CREATE INDEX "memberships_plan_idx" ON "memberships" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "memberships_renewed_from_idx" ON "memberships" USING btree ("renewed_from_id");