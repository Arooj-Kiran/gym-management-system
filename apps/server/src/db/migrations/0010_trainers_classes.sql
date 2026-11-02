CREATE TYPE "public"."shift_status" AS ENUM('SCHEDULED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."time_off_status" AS ENUM('ACTIVE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('BOOKED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."class_session_status" AS ENUM('SCHEDULED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "staff_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"role_note" varchar(120),
	"status" "shift_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_shifts_range" CHECK ("staff_shifts"."ends_at" > "staff_shifts"."starts_at"),
	CONSTRAINT "staff_shifts_max_length" CHECK ("staff_shifts"."ends_at" - "staff_shifts"."starts_at" <= interval '16 hours')
);
--> statement-breakpoint
CREATE TABLE "trainer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainer_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"assigned_by" uuid,
	"ended_by" uuid,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_assignments_dates" CHECK ("trainer_assignments"."end_date" is null or "trainer_assignments"."end_date" >= "trainer_assignments"."start_date")
);
--> statement-breakpoint
CREATE TABLE "trainer_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainer_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_availability_weekday" CHECK ("trainer_availability"."weekday" between 1 and 7),
	CONSTRAINT "trainer_availability_times" CHECK ("trainer_availability"."end_time" > "trainer_availability"."start_time"),
	CONSTRAINT "trainer_availability_effective" CHECK ("trainer_availability"."effective_to" is null or "trainer_availability"."effective_to" >= "trainer_availability"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "trainer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bio" text,
	"specializations" varchar(60)[] DEFAULT '{}' NOT NULL,
	"certifications" varchar(60)[] DEFAULT '{}' NOT NULL,
	"is_bookable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainer_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainer_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" varchar(500),
	"status" time_off_status DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_time_off_range" CHECK ("trainer_time_off"."ends_at" > "trainer_time_off"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trainer_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'BOOKED' NOT NULL,
	"notes" varchar(500),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_range" CHECK ("appointments"."ends_at" > "appointments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "class_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "booking_status" NOT NULL,
	"waitlist_position" integer,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"booked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_bookings_waitlist_position" CHECK (("class_bookings"."status" = 'WAITLISTED') = ("class_bookings"."waitlist_position" is not null)),
	CONSTRAINT "class_bookings_cancelled_at" CHECK (("class_bookings"."status" = 'CANCELLED') = ("class_bookings"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"trainer_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" smallint NOT NULL,
	"room" "citext",
	"status" "class_session_status" DEFAULT 'SCHEDULED' NOT NULL,
	"cancel_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_range" CHECK ("class_sessions"."ends_at" > "class_sessions"."starts_at"),
	CONSTRAINT "class_sessions_capacity" CHECK ("class_sessions"."capacity" between 1 and 200),
	CONSTRAINT "class_sessions_cancel_reason" CHECK (("class_sessions"."status" = 'CANCELLED') = ("class_sessions"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "fitness_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "citext" NOT NULL,
	"description" varchar(1000),
	"default_duration_minutes" smallint NOT NULL,
	"default_capacity" smallint NOT NULL,
	"default_trainer_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_classes_duration" CHECK ("fitness_classes"."default_duration_minutes" between 15 and 240),
	CONSTRAINT "fitness_classes_capacity" CHECK ("fitness_classes"."default_capacity" between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD CONSTRAINT "trainer_assignments_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD CONSTRAINT "trainer_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD CONSTRAINT "trainer_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_assignments" ADD CONSTRAINT "trainer_assignments_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_availability" ADD CONSTRAINT "trainer_availability_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_time_off" ADD CONSTRAINT "trainer_time_off_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_time_off" ADD CONSTRAINT "trainer_time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_class_id_fitness_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."fitness_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_classes" ADD CONSTRAINT "fitness_classes_default_trainer_id_users_id_fk" FOREIGN KEY ("default_trainer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_shifts_user_starts_idx" ON "staff_shifts" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_shifts_starts_idx" ON "staff_shifts" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trainer_assignments_active_key" ON "trainer_assignments" USING btree ("trainer_id","member_id") WHERE "trainer_assignments"."end_date" is null;--> statement-breakpoint
CREATE INDEX "trainer_assignments_member_idx" ON "trainer_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "trainer_availability_trainer_idx" ON "trainer_availability" USING btree ("trainer_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "trainer_profiles_user_key" ON "trainer_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trainer_time_off_trainer_idx" ON "trainer_time_off" USING btree ("trainer_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_trainer_starts_idx" ON "appointments" USING btree ("trainer_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_member_starts_idx" ON "appointments" USING btree ("member_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "class_bookings_active_key" ON "class_bookings" USING btree ("session_id","member_id") WHERE "class_bookings"."status" in ('BOOKED', 'WAITLISTED');--> statement-breakpoint
CREATE INDEX "class_bookings_session_idx" ON "class_bookings" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "class_bookings_member_idx" ON "class_bookings" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "class_sessions_starts_idx" ON "class_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "class_sessions_trainer_starts_idx" ON "class_sessions" USING btree ("trainer_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_sessions_class_idx" ON "class_sessions" USING btree ("class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_classes_name_key" ON "fitness_classes" USING btree ("name");