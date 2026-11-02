-- PLAN §3.7 / §3.9: double bookings are impossible at the database level, not only in the
-- services. Each constraint name is mapped to a 409 error code by the service that writes the row.
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_no_overlap"
  EXCLUDE USING gist ("user_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" = 'SCHEDULED');--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_trainer_no_overlap"
  EXCLUDE USING gist ("trainer_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" = 'SCHEDULED');--> statement-breakpoint
-- Rooms compare case-insensitively ("Studio A" = "studio a").
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_no_overlap"
  EXCLUDE USING gist ((lower("room"::text)) WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" = 'SCHEDULED' AND "room" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_trainer_no_overlap"
  EXCLUDE USING gist ("trainer_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" = 'BOOKED');--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_member_no_overlap"
  EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" = 'BOOKED');--> statement-breakpoint
-- §3.7: a trainer profile belongs to a user whose role is TRAINER.
CREATE OR REPLACE FUNCTION check_trainer_profile_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'TRAINER') THEN
    RAISE EXCEPTION 'trainer profiles belong to trainer accounts only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER trainer_profiles_role_guard
  BEFORE INSERT OR UPDATE OF user_id ON "trainer_profiles"
  FOR EACH ROW EXECUTE FUNCTION check_trainer_profile_role();
