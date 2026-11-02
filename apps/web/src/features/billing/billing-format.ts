import { PAYMENT_METHOD_LABELS, type InvoiceStatus, type PaymentMethod } from '@gms/shared';
import type { BadgeTone } from '../../components/ui/badge';

export const INVOICE_TONES: Record<InvoiceStatus, BadgeTone> = {
  PENDING: 'warning',
  PARTIALLY_PAID: 'primary',
  PAID: 'success',
  OVERDUE: 'danger',
  REFUNDED: 'neutral',
  VOID: 'neutral',
};

/** Statuses that still expect money. */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'OVERDUE',
];

export const isOpenInvoice = (status: InvoiceStatus) => OPEN_INVOICE_STATUSES.includes(status);

/** "Card · POS-1182" */
export function methodLabel(method: PaymentMethod, reference?: string | null) {
  return reference
    ? `${PAYMENT_METHOD_LABELS[method]} · ${reference}`
    : PAYMENT_METHOD_LABELS[method];
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Major units as typed ("4500", "4,500.50") → minor units, or null when it is not a valid
 * positive amount. The server re-checks the amount against the balance.
 */
export function parseMoneyInput(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, '');
  if (!AMOUNT_PATTERN.test(cleaned)) return null;
  const minor = Math.round(Number(cleaned) * 100);
  return minor > 0 ? minor : null;
}

/** Minor units → an editable major-unit string ("4500" or "4500.50"). */
export function moneyInputValue(minor: number) {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** Receipts open in their own tab, ready to print. */
export function openReceipt(paymentId: string, portal = false) {
  window.open(
    portal ? `/portal/payments/${paymentId}/receipt` : `/payments/${paymentId}/receipt`,
    '_blank',
    'noopener',
  );
}
