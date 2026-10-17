-- The member code sequence belongs to its column (dropped with it, dumped with it).
ALTER SEQUENCE "member_code_seq" OWNED BY "members"."member_code";--> statement-breakpoint
-- Member codes are printed on cards and receipts: once issued they never change (PLAN §3.2).
CREATE OR REPLACE FUNCTION reject_member_code_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.member_code IS DISTINCT FROM OLD.member_code THEN
    RAISE EXCEPTION 'member_code is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER members_member_code_immutable
  BEFORE UPDATE OF member_code ON "members"
  FOR EACH ROW EXECUTE FUNCTION reject_member_code_change();
