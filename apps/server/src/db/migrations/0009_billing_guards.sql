-- The billing number sequences belong to their columns (dropped with them, dumped with them).
ALTER SEQUENCE "invoice_number_seq" OWNED BY "invoices"."invoice_number";--> statement-breakpoint
ALTER SEQUENCE "receipt_number_seq" OWNED BY "payments"."receipt_number";--> statement-breakpoint
ALTER SEQUENCE "refund_number_seq" OWNED BY "refunds"."refund_number";--> statement-breakpoint
-- PLAN §3.4: an invoice is never deleted (it is voided) and what it charges, and to whom, never
-- changes once issued. Only the status, the void fields and the description stay writable.
CREATE OR REPLACE FUNCTION reject_invoice_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices are never deleted; void them instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
    OR NEW.member_id IS DISTINCT FROM OLD.member_id
    OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
    OR NEW.amount_due_minor IS DISTINCT FROM OLD.amount_due_minor THEN
    RAISE EXCEPTION 'invoice number, member, membership and amount are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'VOID' AND NEW.status IS DISTINCT FROM 'VOID' THEN
    RAISE EXCEPTION 'a void invoice cannot be reopened'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER invoices_guard
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION reject_invoice_change();--> statement-breakpoint
-- Money received is never deleted or rewritten; refunds are separate rows. Only the status may
-- move (an online payment confirmed or failed by the provider, D8).
CREATE OR REPLACE FUNCTION reject_payment_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are never deleted; refund them instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.member_id IS DISTINCT FROM OLD.member_id
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.method IS DISTINCT FROM OLD.method
    OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'a recorded payment is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER payments_guard
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION reject_payment_change();--> statement-breakpoint
-- Refunds are append-only, like the audit log (RULES §6).
CREATE TRIGGER refunds_append_only
  BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
--> statement-breakpoint
-- Current memberships assigned before billing existed get their invoice now, so every priced
-- period can be paid (and, with C1 on, activated). The overdue job sets OVERDUE at startup.
INSERT INTO "invoices" ("member_id", "membership_id", "description", "amount_due_minor", "due_date", "status")
SELECT m.member_id, m.id,
  left(m.plan_name_snapshot || ' membership, ' || m.start_date || ' to ' || m.end_date, 200),
  m.price_minor_snapshot,
  m.start_date + s.invoice_due_days,
  'PENDING'
FROM "memberships" m
CROSS JOIN (SELECT "invoice_due_days" FROM "gym_settings" LIMIT 1) s
WHERE m.status IN ('PENDING', 'ACTIVE', 'SUSPENDED')
  AND m.price_minor_snapshot > 0
  AND NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i.membership_id = m.id)
ORDER BY m.created_at, m.id;
