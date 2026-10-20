CREATE TYPE "public"."access_reason" AS ENUM('GRANTED', 'MEMBER_NOT_RECOGNIZED', 'MEMBER_INACTIVE', 'ACCESS_BLOCKED', 'NO_MEMBERSHIP', 'MEMBERSHIP_NOT_ACTIVATED', 'MEMBERSHIP_NOT_STARTED', 'MEMBERSHIP_EXPIRED', 'MEMBERSHIP_CANCELLED', 'MEMBERSHIP_SUSPENDED', 'OUTSIDE_ACCESS_HOURS', 'SCANNER_UNAVAILABLE', 'AUTHORIZATION_UNAVAILABLE', 'DEVICE_NOT_AUTHORIZED');--> statement-breakpoint
CREATE TYPE "public"."access_result" AS ENUM('GRANTED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."access_source" AS ENUM('SIMULATED', 'REAL', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('VALID', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."correction_field" AS ENUM('CHECK_IN_AT', 'CHECK_OUT_AT', 'STATUS');--> statement-breakpoint
CREATE TYPE "public"."device_health" AS ENUM('OK', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('SIMULATED', 'REAL');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('ACTIVE', 'REVOKED', 'DELETED');--> statement-breakpoint
CREATE TABLE "access_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid,
	"source" "access_source" NOT NULL,
	"event_id" uuid,
	"member_id" uuid,
	"membership_id" uuid,
	"result" "access_result" NOT NULL,
	"reason" "access_reason" NOT NULL,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"attendance_id" uuid,
	"verified_by_user_id" uuid,
	"uploaded_from_outbox" boolean DEFAULT false NOT NULL,
	"error_code" varchar(64),
	CONSTRAINT "access_attempts_result_matches_reason" CHECK (("access_attempts"."result" = 'GRANTED') = ("access_attempts"."reason" = 'GRANTED')),
	CONSTRAINT "access_attempts_granted_is_complete" CHECK ("access_attempts"."result" = 'DENIED' or ("access_attempts"."member_id" is not null and "access_attempts"."membership_id" is not null and "access_attempts"."attendance_id" is not null)),
	CONSTRAINT "access_attempts_duplicate_is_granted" CHECK (not "access_attempts"."is_duplicate" or "access_attempts"."result" = 'GRANTED'),
	CONSTRAINT "access_attempts_manual_is_verified" CHECK (("access_attempts"."source" = 'MANUAL') = ("access_attempts"."verified_by_user_id" is not null)),
	CONSTRAINT "access_attempts_manual_has_no_device" CHECK ("access_attempts"."source" <> 'MANUAL' or "access_attempts"."device_id" is null),
	CONSTRAINT "access_attempts_outbox_is_denied" CHECK (not "access_attempts"."uploaded_from_outbox" or ("access_attempts"."result" = 'DENIED' and "access_attempts"."reason" = 'AUTHORIZATION_UNAVAILABLE'))
);
--> statement-breakpoint
CREATE TABLE "access_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"location" varchar(80) NOT NULL,
	"device_type" "device_type" NOT NULL,
	"vendor" varchar(40),
	"model" varchar(60),
	"serial_number" varchar(60),
	"api_key_hash" varchar(64) NOT NULL,
	"key_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "device_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_health" "device_health",
	"last_error_code" varchar(64),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_devices_api_key_hash_hex" CHECK ("access_devices"."api_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "access_devices_simulated_has_no_hardware" CHECK ("access_devices"."device_type" = 'REAL' or ("access_devices"."vendor" is null and "access_devices"."model" is null and "access_devices"."serial_number" is null))
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_id" uuid NOT NULL,
	"field" "correction_field" NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text NOT NULL,
	"corrected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_reason_present" CHECK (char_length(trim("attendance_corrections"."reason")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_out_at" timestamp with time zone,
	"source" "access_source" NOT NULL,
	"access_attempt_id" uuid NOT NULL,
	"status" "attendance_status" DEFAULT 'VALID' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_check_out_after_check_in" CHECK ("attendance_records"."check_out_at" is null or "attendance_records"."check_out_at" > "attendance_records"."check_in_at"),
	CONSTRAINT "attendance_records_manual_has_creator" CHECK ("attendance_records"."source" <> 'MANUAL' or "attendance_records"."created_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "biometric_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"consent_version" varchar(32) NOT NULL,
	"consent_text_sha256" varchar(64) NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_recorded_by" uuid,
	CONSTRAINT "biometric_consents_text_hash_hex" CHECK ("biometric_consents"."consent_text_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "biometric_consents_withdrawal_consistent" CHECK (("biometric_consents"."withdrawn_at" is null) = ("biometric_consents"."withdrawn_recorded_by" is null))
);
--> statement-breakpoint
CREATE TABLE "biometric_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"template_ref" varchar(64),
	"consent_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'ACTIVE' NOT NULL,
	"enrolled_by" uuid NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(500),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "biometric_enrollments_sim_ref_matches_provider" CHECK ("biometric_enrollments"."template_ref" is null or (("biometric_enrollments"."provider" = 'SIMULATED') = ("biometric_enrollments"."template_ref" like 'SIM-%'))),
	CONSTRAINT "biometric_enrollments_deleted_has_no_ref" CHECK (("biometric_enrollments"."status" = 'DELETED') = ("biometric_enrollments"."template_ref" is null) and ("biometric_enrollments"."status" = 'DELETED') = ("biometric_enrollments"."deleted_at" is not null)),
	CONSTRAINT "biometric_enrollments_revocation_recorded" CHECK (("biometric_enrollments"."status" = 'ACTIVE') = ("biometric_enrollments"."revoked_at" is null))
);
--> statement-breakpoint
ALTER TABLE "access_attempts" ADD CONSTRAINT "access_attempts_device_id_access_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."access_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_attempts" ADD CONSTRAINT "access_attempts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_attempts" ADD CONSTRAINT "access_attempts_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_attempts" ADD CONSTRAINT "access_attempts_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_devices" ADD CONSTRAINT "access_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_id_attendance_records_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_access_attempt_id_access_attempts_id_fk" FOREIGN KEY ("access_attempt_id") REFERENCES "public"."access_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_withdrawn_recorded_by_users_id_fk" FOREIGN KEY ("withdrawn_recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_device_id_access_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."access_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_consent_id_biometric_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."biometric_consents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_enrolled_by_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_attempts_device_event_key" ON "access_attempts" USING btree ("device_id","event_id") WHERE "access_attempts"."event_id" is not null;--> statement-breakpoint
CREATE INDEX "access_attempts_occurred_idx" ON "access_attempts" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "access_attempts_member_occurred_idx" ON "access_attempts" USING btree ("member_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "access_attempts_result_reason_occurred_idx" ON "access_attempts" USING btree ("result","reason","occurred_at");--> statement-breakpoint
CREATE INDEX "access_attempts_attendance_idx" ON "access_attempts" USING btree ("attendance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_devices_api_key_hash_key" ON "access_devices" USING btree ("api_key_hash");--> statement-breakpoint
CREATE INDEX "attendance_corrections_attendance_created_idx" ON "attendance_corrections" USING btree ("attendance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_access_attempt_key" ON "attendance_records" USING btree ("access_attempt_id");--> statement-breakpoint
CREATE INDEX "attendance_records_member_check_in_idx" ON "attendance_records" USING btree ("member_id","check_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attendance_records_check_in_idx" ON "attendance_records" USING btree ("check_in_at");--> statement-breakpoint
CREATE INDEX "biometric_consents_member_idx" ON "biometric_consents" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_consents_member_current_key" ON "biometric_consents" USING btree ("member_id") WHERE "biometric_consents"."withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_enrollments_device_ref_active_key" ON "biometric_enrollments" USING btree ("device_id","template_ref") WHERE "biometric_enrollments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_enrollments_member_device_active_key" ON "biometric_enrollments" USING btree ("member_id","device_id") WHERE "biometric_enrollments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "biometric_enrollments_member_idx" ON "biometric_enrollments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "biometric_enrollments_device_status_idx" ON "biometric_enrollments" USING btree ("device_id","status");