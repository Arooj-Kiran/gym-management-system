import { INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgEnum,
  pgSequence,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz } from './columns';
import { members } from './members';
import { memberships } from './memberships';
import { users } from './users';

export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);

export const invoiceNumberSeq = pgSequence('invoice_number_seq', { startWith: 1, increment: 1 });
export const receiptNumberSeq = pgSequence('receipt_number_seq', { startWith: 1, increment: 1 });
export const refundNumberSeq = pgSequence('refund_number_seq', { startWith: 1, increment: 1 });

/**
 * What a member owes (PLAN §3.4). `status` is a stored copy of computeInvoiceStatus(), rewritten
 * inside every payment, refund and void transaction and by the daily overdue job. Voiding is the
 * only way to "remove" an invoice.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    /** INV-000001 … Immutable (trigger in the migrations). */
    invoiceNumber: varchar('invoice_number', { length: 16 })
      .notNull()
      .default(sql`'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0')`),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** null for a manual charge; at most one invoice per membership period. */
    membershipId: uuid('membership_id').references(() => memberships.id, {
      onDelete: 'restrict',
    }),
    description: varchar('description', { length: 200 }).notNull(),
    amountDueMinor: bigint('amount_due_minor', { mode: 'number' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('PENDING'),
    voidedAt: timestamptz('voided_at'),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'restrict' }),
    voidReason: varchar('void_reason', { length: 500 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('invoices_invoice_number_key').on(t.invoiceNumber),
    uniqueIndex('invoices_membership_key')
      .on(t.membershipId)
      .where(sql`${t.membershipId} is not null`),
    index('invoices_member_due_idx').on(t.memberId, t.dueDate),
    index('invoices_status_due_idx').on(t.status, t.dueDate),
    check('invoices_amount_positive', sql`${t.amountDueMinor} > 0`),
    check('invoices_description_not_blank', sql`char_length(btrim(${t.description})) > 0`),
    check(
      'invoices_void_consistent',
      sql`(${t.status} = 'VOID') = (${t.voidedAt} is not null)
        and (${t.voidedAt} is null or ${t.voidReason} is not null)`,
    ),
  ],
);

/** Money received. Never deleted (trigger); only the status may change. */
export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    /** RCP-000001 … Immutable (trigger in the migrations). */
    receiptNumber: varchar('receipt_number', { length: 16 })
      .notNull()
      .default(sql`'RCP-' || lpad(nextval('receipt_number_seq')::text, 6, '0')`),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    method: paymentMethodEnum('method').notNull(),
    reference: varchar('reference', { length: 120 }),
    status: paymentStatusEnum('status').notNull(),
    /** Set only by a verified provider webhook (not built until a provider is configured, D8). */
    provider: varchar('provider', { length: 40 }),
    providerPaymentId: varchar('provider_payment_id', { length: 120 }),
    receivedAt: timestamptz('received_at').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'restrict' }),
    notes: varchar('notes', { length: 500 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('payments_receipt_number_key').on(t.receiptNumber),
    uniqueIndex('payments_provider_payment_key').on(t.provider, t.providerPaymentId),
    index('payments_member_received_idx').on(t.memberId, t.receivedAt.desc()),
    index('payments_received_idx').on(t.receivedAt),
    index('payments_invoice_idx').on(t.invoiceId),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'payments_reference_present',
      sql`${t.method} not in ('BANK_TRANSFER', 'CARD') or char_length(btrim(coalesce(${t.reference}, ''))) > 0`,
    ),
    // An online payment is completed only by a verified provider confirmation, never by hand.
    check(
      'payments_online_needs_provider',
      sql`${t.method} <> 'ONLINE' or ${t.status} <> 'COMPLETED' or ${t.providerPaymentId} is not null`,
    ),
    check('payments_counter_completed', sql`${t.method} = 'ONLINE' or ${t.status} = 'COMPLETED'`),
  ],
);

/** Money returned from a payment. Append-only (trigger). Σ refunds ≤ the payment (service, under lock). */
export const refunds = pgTable(
  'refunds',
  {
    id: primaryId(),
    /** RFD-000001 … */
    refundNumber: varchar('refund_number', { length: 16 })
      .notNull()
      .default(sql`'RFD-' || lpad(nextval('refund_number_seq')::text, 6, '0')`),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    method: paymentMethodEnum('method').notNull(),
    refundedAt: timestamptz('refunded_at').notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('refunds_refund_number_key').on(t.refundNumber),
    index('refunds_payment_idx').on(t.paymentId),
    index('refunds_refunded_idx').on(t.refundedAt),
    check('refunds_amount_positive', sql`${t.amountMinor} > 0`),
    check('refunds_reason_not_blank', sql`char_length(btrim(${t.reason})) > 0`),
    check('refunds_counter_method', sql`${t.method} <> 'ONLINE'`),
  ],
);
