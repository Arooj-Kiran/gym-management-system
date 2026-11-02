import type { InvoiceStatus, PaymentMethod } from './enums';
import { addDays } from './memberships';

/**
 * Billing rules shared by the server (which enforces them inside the payment and refund
 * transactions) and the web app (which only uses them to guide the forms). Money is always an
 * integer number of minor units (paisa for PKR); never a float.
 */

export interface InvoiceAmounts {
  amountDueMinor: number;
  /** Σ COMPLETED payments on the invoice. */
  paidMinor: number;
  /** Σ refunds of those payments. */
  refundedMinor: number;
  /** YYYY-MM-DD, gym time. */
  dueDate: string;
  voided: boolean;
}

/** What the gym actually holds for the invoice: completed payments minus refunds. */
export function netPaidMinor(amounts: Pick<InvoiceAmounts, 'paidMinor' | 'refundedMinor'>) {
  return amounts.paidMinor - amounts.refundedMinor;
}

/**
 * PLAN §3.4, in this order: VOID if voided → PAID if net paid ≥ amount due → REFUNDED if money
 * came in and all of it went back → PARTIALLY_PAID if anything is held → OVERDUE once the due
 * date has passed → PENDING.
 */
export function computeInvoiceStatus(amounts: InvoiceAmounts, today: string): InvoiceStatus {
  if (amounts.voided) return 'VOID';
  const net = netPaidMinor(amounts);
  if (net >= amounts.amountDueMinor) return 'PAID';
  if (amounts.paidMinor > 0 && net === 0) return 'REFUNDED';
  if (net > 0) return 'PARTIALLY_PAID';
  if (amounts.dueDate < today) return 'OVERDUE';
  return 'PENDING';
}

/** Still owed. A void invoice owes nothing. */
export function invoiceBalanceMinor(
  amounts: Pick<InvoiceAmounts, 'amountDueMinor' | 'paidMinor' | 'refundedMinor' | 'voided'>,
) {
  if (amounts.voided) return 0;
  return Math.max(0, amounts.amountDueMinor - netPaidMinor(amounts));
}

/** A membership invoice falls due `invoiceDueDays` after the period starts (0 = on the start date). */
export function invoiceDueDate(startDate: string, invoiceDueDays: number) {
  return addDays(startDate, invoiceDueDays);
}

/** Bank transfers and card payments must carry the bank or terminal reference. */
export function paymentReferenceRequired(method: PaymentMethod) {
  return method === 'BANK_TRANSFER' || method === 'CARD';
}

/** Room left on a payment for refunds. */
export function refundableMinor(payment: { amountMinor: number; refundedMinor: number }) {
  return Math.max(0, payment.amountMinor - payment.refundedMinor);
}

export const BILLING_LIMITS = {
  /** Same ceiling as plan prices. */
  maxAmountMinor: 10_000_000_000,
  descriptionMax: 200,
  referenceMax: 120,
  notesMax: 500,
  /** A manual invoice may fall due at most this many days ahead. */
  maxDueAdvanceDays: 365,
} as const;
