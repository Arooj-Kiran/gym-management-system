import { z } from 'zod';
import { BILLING_LIMITS, paymentReferenceRequired } from '../billing';
import {
  COUNTER_PAYMENT_METHODS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '../enums';
import {
  listQueryBase,
  optionalIsoDateSchema,
  optionalTextSchema,
  requiredReasonSchema,
} from './common';

const amountSchema = z
  .int('Enter the amount in whole paisa')
  .positive('Enter an amount greater than zero')
  .max(BILLING_LIMITS.maxAmountMinor, 'Amount is too high');

const timestampSchema = z.iso.datetime({ offset: true, error: 'Enter a valid date and time' });

/** A charge that is not a membership (locker, towel, personal training session…). */
export const createInvoiceSchema = z.strictObject({
  memberId: z.uuid({ error: 'Choose a member' }),
  description: z
    .string({ error: 'Describe the charge' })
    .trim()
    .min(2, 'Describe the charge')
    .max(
      BILLING_LIMITS.descriptionMax,
      `Must be ${BILLING_LIMITS.descriptionMax} characters or fewer`,
    ),
  amountDueMinor: amountSchema,
  /** Defaults to today in gym time. */
  dueDate: optionalIsoDateSchema,
});
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

export const voidInvoiceSchema = z.strictObject({ reason: requiredReasonSchema });
export type VoidInvoiceInput = z.input<typeof voidInvoiceSchema>;

export const recordPaymentSchema = z
  .strictObject({
    invoiceId: z.uuid({ error: 'Choose an invoice' }),
    amountMinor: amountSchema,
    method: z.enum(PAYMENT_METHODS, { error: 'Choose how the member paid' }),
    reference: optionalTextSchema(BILLING_LIMITS.referenceMax),
    /** When the money was received; defaults to now. Never in the future (server-checked). */
    receivedAt: timestampSchema.optional(),
    notes: optionalTextSchema(BILLING_LIMITS.notesMax),
  })
  .superRefine((input, ctx) => {
    if (paymentReferenceRequired(input.method) && !input.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message:
          input.method === 'CARD'
            ? 'Enter the card terminal reference'
            : 'Enter the bank transfer reference',
      });
    }
  });
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const refundPaymentSchema = z.strictObject({
  amountMinor: amountSchema,
  reason: requiredReasonSchema,
  method: z.enum(COUNTER_PAYMENT_METHODS, { error: 'Choose how the money is returned' }),
});
export type RefundPaymentInput = z.input<typeof refundPaymentSchema>;

/** `from`/`to` are inclusive due dates. */
export const invoiceListQuerySchema = z.strictObject({
  ...listQueryBase,
  status: z.enum(INVOICE_STATUSES).optional(),
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
});
export type InvoiceListQuery = z.input<typeof invoiceListQuerySchema>;

/** `from`/`to` are inclusive calendar days (gym time) of when the money was received. */
export const paymentListQuerySchema = z.strictObject({
  ...listQueryBase,
  method: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  invoiceId: z.uuid({ error: 'Invalid invoice' }).optional(),
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
});
export type PaymentListQuery = z.input<typeof paymentListQuerySchema>;

export const refundListQuerySchema = z.strictObject({
  ...listQueryBase,
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
});
export type RefundListQuery = z.input<typeof refundListQuerySchema>;

export const myBillingQuerySchema = z.strictObject({
  page: listQueryBase.page,
  pageSize: listQueryBase.pageSize,
});

export interface BillingMemberRef {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
}

export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  member: BillingMemberRef;
  /** null for a manual charge. */
  membershipId: string | null;
  description: string;
  amountDueMinor: number;
  /** Σ completed payments. */
  paidMinor: number;
  refundedMinor: number;
  /** Still owed; 0 when void. */
  balanceMinor: number;
  dueDate: string;
  status: InvoiceStatus;
  /** Whether a payment smaller than the balance is accepted (the plan's rule; always for manual charges). */
  allowPartialPayment: boolean;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PaymentDto {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDescription: string;
  member: BillingMemberRef;
  amountMinor: number;
  refundedMinor: number;
  /** What can still be refunded from this payment. */
  refundableMinor: number;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  receivedAt: string;
  recordedByName: string | null;
  notes: string | null;
  createdAt: string;
}

export interface RefundDto {
  id: string;
  refundNumber: string;
  paymentId: string;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  member: BillingMemberRef;
  amountMinor: number;
  reason: string;
  method: PaymentMethod;
  refundedAt: string;
  recordedByName: string | null;
}

export interface InvoiceDetailDto extends InvoiceDto {
  payments: PaymentDto[];
  refunds: RefundDto[];
}

/** The membership's invoice, as shown on membership cards (C1: the outstanding balance). */
export interface MembershipInvoiceBrief {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  amountDueMinor: number;
  balanceMinor: number;
  dueDate: string;
}

/** Everything a printed receipt needs, and nothing more. */
export interface ReceiptDto {
  gymName: string;
  currencyCode: string;
  timezone: string;
  receiptNumber: string;
  receivedAt: string;
  amountMinor: number;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  member: { memberCode: string; firstName: string; lastName: string };
  invoice: {
    invoiceNumber: string;
    description: string;
    amountDueMinor: number;
    paidMinor: number;
    balanceMinor: number;
    status: InvoiceStatus;
    dueDate: string;
  };
  refunds: {
    refundNumber: string;
    amountMinor: number;
    method: PaymentMethod;
    refundedAt: string;
  }[];
  recordedByName: string | null;
}

/** Portal views: no staff names, notes or void reasons. */
export interface MyInvoiceDto {
  id: string;
  invoiceNumber: string;
  description: string;
  amountDueMinor: number;
  paidMinor: number;
  balanceMinor: number;
  dueDate: string;
  status: InvoiceStatus;
  createdAt: string;
}

export interface MyPaymentDto {
  id: string;
  receiptNumber: string;
  invoiceNumber: string;
  description: string;
  amountMinor: number;
  refundedMinor: number;
  method: PaymentMethod;
  status: PaymentStatus;
  receivedAt: string;
}

export interface MyBillingSummary {
  /** Σ balance over the member's open invoices. */
  outstandingMinor: number;
  overdueMinor: number;
}
