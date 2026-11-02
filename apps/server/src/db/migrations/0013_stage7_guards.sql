-- The asset-tag sequence belongs to its column (dropped with it, dumped with it).
ALTER SEQUENCE "equipment_tag_seq" OWNED BY "equipment"."asset_tag";--> statement-breakpoint
-- PLAN §3.10: maintenance history is never rewritten; a mistake is corrected by a new record.
CREATE TRIGGER maintenance_records_append_only
  BEFORE UPDATE OR DELETE ON "maintenance_records"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();--> statement-breakpoint
-- PLAN §3.11: a delivery row records the one send attempt for its channel.
CREATE TRIGGER notification_deliveries_append_only
  BEFORE UPDATE OR DELETE ON "notification_deliveries"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();--> statement-breakpoint
-- A notification's content never changes after it is created; only read_at may be set or cleared.
CREATE OR REPLACE FUNCTION reject_notification_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notifications are never deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
    OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
    OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only the read state of a notification can change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER notifications_guard
  BEFORE UPDATE OR DELETE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION reject_notification_change();
