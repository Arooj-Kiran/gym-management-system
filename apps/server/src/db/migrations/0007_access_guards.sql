-- PLAN §3.5: an access attempt and the attendance row it creates reference each other. The
-- attempt is written first, so its link to the attendance row is checked at commit.
ALTER TABLE "access_attempts" ADD CONSTRAINT "access_attempts_attendance_id_attendance_records_id_fk"
  FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance_records"("id")
  ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
-- The access log and the correction history are append-only, like the audit log (RULES §6).
CREATE TRIGGER access_attempts_append_only
  BEFORE UPDATE OR DELETE ON "access_attempts"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();--> statement-breakpoint
CREATE TRIGGER attendance_corrections_append_only
  BEFORE UPDATE OR DELETE ON "attendance_corrections"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
