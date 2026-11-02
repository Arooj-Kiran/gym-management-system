import { describe, expect, it } from 'vitest';
import {
  computeInvoiceStatus,
  createInvoiceSchema,
  invoiceBalanceMinor,
  invoiceDueDate,
  invoiceListQuerySchema,
  paymentListQuerySchema,
  paymentReferenceRequired,
  recordPaymentSchema,
  refundableMinor,
  refundPaymentSchema,
  updateSettingsSchema,
  type InvoiceAmounts,
} from '../src';

const TODAY = '2026-10-20';
const invoice = (overrides: Partial<InvoiceAmounts> = {}): InvoiceAmounts => ({
  amountDueMinor: 500_000,
  paidMinor: 0,
  refundedMinor: 0,
  dueDate: TODAY,
  voided: false,
  ...overrides,
});

describe('computeInvoiceStatus (PLAN §3.4, in order)', () => {
  it('is PENDING with nothing paid on or before the due date', () => {
    expect(computeInvoiceStatus(invoice(), TODAY)).toBe('PENDING');
    expect(computeInvoiceStatus(invoice({ dueDate: '2026-11-01' }), TODAY)).toBe('PENDING');
  });

  it('is OVERDUE the day after the due date', () => {
    expect(computeInvoiceStatus(invoice({ dueDate: '2026-10-19' }), TODAY)).toBe('OVERDUE');
  });

  it('is PARTIALLY_PAID when part is held, even past the due date', () => {
    const partial = invoice({ paidMinor: 200_000, dueDate: '2026-10-01' });
    expect(computeInvoiceStatus(partial, TODAY)).toBe('PARTIALLY_PAID');
  });

  it('is PAID when the net paid reaches the amount due', () => {
    expect(computeInvoiceStatus(invoice({ paidMinor: 500_000 }), TODAY)).toBe('PAID');
    expect(
      computeInvoiceStatus(invoice({ paidMinor: 500_000, dueDate: '2026-01-01' }), TODAY),
    ).toBe('PAID');
  });

  it('drops back after a partial refund and is REFUNDED once everything went back', () => {
    expect(
      computeInvoiceStatus(invoice({ paidMinor: 500_000, refundedMinor: 100_000 }), TODAY),
    ).toBe('PARTIALLY_PAID');
    expect(
      computeInvoiceStatus(
        invoice({ paidMinor: 500_000, refundedMinor: 500_000, dueDate: '2026-01-01' }),
        TODAY,
      ),
    ).toBe('REFUNDED');
  });

  it('is VOID whatever was paid', () => {
    expect(computeInvoiceStatus(invoice({ voided: true }), TODAY)).toBe('VOID');
    expect(computeInvoiceStatus(invoice({ voided: true, paidMinor: 500_000 }), TODAY)).toBe('VOID');
  });
});

describe('invoiceBalanceMinor', () => {
  it('is what is still owed, never negative, and zero when void', () => {
    expect(invoiceBalanceMinor(invoice())).toBe(500_000);
    expect(invoiceBalanceMinor(invoice({ paidMinor: 150_000 }))).toBe(350_000);
    expect(invoiceBalanceMinor(invoice({ paidMinor: 500_000, refundedMinor: 50_000 }))).toBe(
      50_000,
    );
    expect(invoiceBalanceMinor(invoice({ paidMinor: 600_000 }))).toBe(0);
    expect(invoiceBalanceMinor(invoice({ voided: true }))).toBe(0);
  });
});

describe('billing helpers', () => {
  it('puts the due date the configured days after the start date', () => {
    expect(invoiceDueDate('2026-10-20', 0)).toBe('2026-10-20');
    expect(invoiceDueDate('2026-12-25', 10)).toBe('2027-01-04');
  });

  it('requires a reference for bank transfers and cards only', () => {
    expect(paymentReferenceRequired('BANK_TRANSFER')).toBe(true);
    expect(paymentReferenceRequired('CARD')).toBe(true);
    expect(paymentReferenceRequired('CASH')).toBe(false);
    expect(paymentReferenceRequired('OTHER')).toBe(false);
  });

  it('never allows refunding more than is left on a payment', () => {
    expect(refundableMinor({ amountMinor: 300_000, refundedMinor: 100_000 })).toBe(200_000);
    expect(refundableMinor({ amountMinor: 300_000, refundedMinor: 300_000 })).toBe(0);
  });
});

describe('billing schemas', () => {
  const invoiceId = '0b6f6d4c-34f3-4c55-9a39-0d6c0c3c6f11';

  it('accepts a cash payment without a reference', () => {
    const parsed = recordPaymentSchema.parse({ invoiceId, amountMinor: 250_000, method: 'CASH' });
    expect(parsed.reference).toBeNull();
  });

  it('requires a reference for bank transfers and cards', () => {
    for (const method of ['BANK_TRANSFER', 'CARD']) {
      const result = recordPaymentSchema.safeParse({ invoiceId, amountMinor: 1, method });
      expect(result.success, method).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['reference']);
    }
    expect(
      recordPaymentSchema.safeParse({
        invoiceId,
        amountMinor: 1,
        method: 'CARD',
        reference: 'POS-88341',
      }).success,
    ).toBe(true);
  });

  it('rejects zero, negative, fractional and oversized amounts', () => {
    for (const amountMinor of [0, -100, 10.5, 10_000_000_001]) {
      expect(
        recordPaymentSchema.safeParse({ invoiceId, amountMinor, method: 'CASH' }).success,
        String(amountMinor),
      ).toBe(false);
    }
  });

  it('rejects a reference longer than 120 characters and unknown fields', () => {
    expect(
      recordPaymentSchema.safeParse({
        invoiceId,
        amountMinor: 1,
        method: 'CARD',
        reference: 'x'.repeat(121),
      }).success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({
        invoiceId,
        amountMinor: 1,
        method: 'CASH',
        status: 'COMPLETED',
      }).success,
    ).toBe(false);
  });

  it('only refunds through counter methods and always needs a reason', () => {
    expect(
      refundPaymentSchema.safeParse({ amountMinor: 100, reason: 'Overcharged', method: 'CASH' })
        .success,
    ).toBe(true);
    expect(
      refundPaymentSchema.safeParse({ amountMinor: 100, reason: 'Overcharged', method: 'ONLINE' })
        .success,
    ).toBe(false);
    expect(refundPaymentSchema.safeParse({ amountMinor: 100, method: 'CASH' }).success).toBe(false);
  });

  it('validates a manual charge', () => {
    const memberId = invoiceId;
    expect(
      createInvoiceSchema.safeParse({
        memberId,
        description: 'Locker, October',
        amountDueMinor: 50_000,
      }).success,
    ).toBe(true);
    expect(
      createInvoiceSchema.safeParse({ memberId, description: '', amountDueMinor: 50_000 }).success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({ memberId, description: 'Locker', amountDueMinor: 0 }).success,
    ).toBe(false);
  });

  it('parses list filters', () => {
    expect(invoiceListQuerySchema.parse({ status: 'OVERDUE', from: '2026-10-01' })).toMatchObject({
      status: 'OVERDUE',
      from: '2026-10-01',
      to: null,
      page: 1,
    });
    expect(paymentListQuerySchema.safeParse({ method: 'BITCOIN' }).success).toBe(false);
  });

  it('accepts the C1 setting as a boolean only', () => {
    expect(
      updateSettingsSchema.safeParse({ requireFullPaymentBeforeActivation: true }).success,
    ).toBe(true);
    expect(
      updateSettingsSchema.safeParse({ requireFullPaymentBeforeActivation: 'yes' }).success,
    ).toBe(false);
  });
});
