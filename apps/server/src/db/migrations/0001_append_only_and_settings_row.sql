-- Append-only guard, reused by every history table (audit_logs now; more tables in later stages).
CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();--> statement-breakpoint
-- gym_settings holds exactly one row.
CREATE UNIQUE INDEX "gym_settings_singleton" ON "gym_settings" ((true));--> statement-breakpoint
INSERT INTO "gym_settings" DEFAULT VALUES;
