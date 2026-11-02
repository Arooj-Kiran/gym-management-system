CREATE TYPE "public"."invoice_status" AS ENUM('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'REFUNDED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER', 'ONLINE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('COMPLETED', 'PENDING_CONFIRMATION', 'FAILED');--> statement-breakpoint
CREATE SEQUENCE "public"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."receipt_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."refund_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(16) DEFAULT 'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0') NOT NULL,
	"member_id" uuid NOT NULL,
	"membership_id" uuid,
	"description" varchar(200) NOT NULL,
	"amount_due_minor" bigint NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'PENDING' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" varchar(500),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_positive" CHECK ("invoices"."amount_due_minor" > 0),
	CONSTRAINT "invoices_description_not_blank" CHECK (char_length(btrim("invoices"."description")) > 0),
	CONSTRAINT "invoices_void_consistent" CHECK (("invoices"."status" = 'VOID') = ("invoices"."voided_at" is not null)
        and ("invoices"."voided_at" is null or "invoices"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" varchar(16) DEFAULT 'RCP-' || lpad(nextval('receipt_number_seq')::text, 6, '0') NOT NULL,
	"invoice_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" varchar(120),
	"status" "payment_status" NOT NULL,
	"provider" varchar(40),
	"provider_payment_id" varchar(120),
	"received_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_reference_present" CHECK ("payments"."method" not in ('BANK_TRANSFER', 'CARD') or char_length(btrim(coalesce("payments"."reference", ''))) > 0),
	CONSTRAINT "payments_online_needs_provider" CHECK ("payments"."method" <> 'ONLINE' or "payments"."status" <> 'COMPLETED' or "payments"."provider_payment_id" is not null),
	CONSTRAINT "payments_counter_completed" CHECK ("payments"."method" = 'ONLINE' or "payments"."status" = 'COMPLETED')
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_number" varchar(16) DEFAULT 'RFD-' || lpad(nextval('refund_number_seq')::text, 6, '0') NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" varchar(500) NOT NULL,
	"method" "payment_method" NOT NULL,
	"refunded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_reason_not_blank" CHECK (char_length(btrim("refunds"."reason")) > 0),
	CONSTRAINT "refunds_counter_method" CHECK ("refunds"."method" <> 'ONLINE')
);
--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "require_full_payment_before_activation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_membership_key" ON "invoices" USING btree ("membership_id") WHERE "invoices"."membership_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_member_due_idx" ON "invoices" USING btree ("member_id","due_date");--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_key" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_member_received_idx" ON "payments" USING btree ("member_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_refund_number_key" ON "refunds" USING btree ("refund_number");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_refunded_idx" ON "refunds" USING btree ("refunded_at");