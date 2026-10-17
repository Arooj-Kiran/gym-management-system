-- PLAN §3.3: one member never holds two overlapping current periods (pending, active or
-- suspended). Cancelled and expired rows keep their dates as history and are not checked.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_no_overlap"
  EXCLUDE USING gist (
    "member_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  ) WHERE ("status" IN ('PENDING', 'ACTIVE', 'SUSPENDED'));--> statement-breakpoint
-- Membership history is append-only, like the audit log (RULES §6).
CREATE TRIGGER membership_events_append_only
  BEFORE UPDATE OR DELETE ON "membership_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
