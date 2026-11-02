import type { GymSettingsDto, InvoiceDto, Role } from '@gms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moneyInputValue, parseMoneyInput } from '../src/features/billing/billing-format';
import { RecordPaymentDialog } from '../src/features/billing/record-payment-dialog';
import { PortalPaymentsPage } from '../src/features/portal/portal-payments-page';
import { SettingsPage } from '../src/features/settings/settings-page';
import { fakeMe, mockFetch, renderWithProviders } from './render';

afterEach(() => vi.restoreAllMocks());

const INVOICE: InvoiceDto = {
  id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
  invoiceNumber: 'INV-000042',
  member: {
    id: '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    memberCode: 'M-00021',
    firstName: 'Sana',
    lastName: 'Qureshi',
  },
  membershipId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  description: 'Monthly Unlimited · 1 Oct – 30 Oct 2026',
  amountDueMinor: 800_000,
  paidMinor: 0,
  refundedMinor: 0,
  balanceMinor: 800_000,
  dueDate: '2026-10-08',
  status: 'PENDING',
  allowPartialPayment: false,
  voidedAt: null,
  voidedByName: null,
  voidReason: null,
  createdByName: 'Ayesha Malik',
  createdAt: '2026-10-01T05:00:00.000Z',
};

describe('money input', () => {
  it('reads major units, with separators, into minor units', () => {
    expect(parseMoneyInput('4500')).toBe(450_000);
    expect(parseMoneyInput('4,500.50')).toBe(450_050);
    expect(parseMoneyInput(' 12.5 ')).toBe(1_250);
  });

  it('rejects zero, negatives, extra decimals and text', () => {
    for (const value of ['', '0', '0.00', '-10', '10.555', 'abc', '1e3']) {
      expect(parseMoneyInput(value)).toBeNull();
    }
  });

  it('prints minor units back without needless decimals', () => {
    expect(moneyInputValue(450_000)).toBe('4500');
    expect(moneyInputValue(450_050)).toBe('4500.50');
  });
});

function renderPaymentDialog(invoice: InvoiceDto) {
  const posts: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/payments')) {
        const body = JSON.parse(String(init.body)) as { amountMinor: number };
        posts.push(body);
        return {
          status: 201,
          body: { id: 'p1', receiptNumber: 'RCP-000007', amountMinor: body.amountMinor },
        };
      }
      if (url.includes(`/invoices/${invoice.id}`))
        return { status: 200, body: { ...invoice, payments: [], refunds: [] } };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  const onOpenChange = vi.fn();
  renderWithProviders(
    <RecordPaymentDialog open onOpenChange={onOpenChange} invoiceId={invoice.id} />,
    { me: fakeMe('RECEPTIONIST') },
  );
  return { posts, onOpenChange };
}

describe('RecordPaymentDialog', () => {
  it('prefills the balance and refuses a part payment when the plan does not allow it', async () => {
    const { posts } = renderPaymentDialog(INVOICE);
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    const amount = await within(dialog).findByLabelText(/Amount \(PKR\)/);
    expect(amount).toHaveValue('8000');

    await user.clear(amount);
    await user.type(amount, '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByText(/This plan is paid in full/)).toBeVisible();
    expect(posts).toHaveLength(0);
  });

  it('never lets online payment be chosen and says it needs configuration', async () => {
    renderPaymentDialog(INVOICE);
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    expect(await within(dialog).findByRole('radio', { name: /Online/ })).toBeDisabled();
    expect(within(dialog).getByText('Requires configuration')).toBeVisible();
  });

  it('asks for a reference for card payments, then records the payment', async () => {
    const { posts, onOpenChange } = renderPaymentDialog({ ...INVOICE, allowPartialPayment: true });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    const amount = await within(dialog).findByLabelText(/Amount \(PKR\)/);
    await user.clear(amount);
    await user.type(amount, '3,000');
    await user.click(within(dialog).getByRole('radio', { name: 'Card' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByText('Enter the card terminal reference')).toBeVisible();
    expect(posts).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reference/), 'POS-1182');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      invoiceId: INVOICE.id,
      amountMinor: 300_000,
      method: 'CARD',
      reference: 'POS-1182',
    });
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

const SETTINGS: GymSettingsDto = {
  gymName: 'Iron Valley Fitness',
  expiryReminderDays: 7,
  paymentDueReminderDays: 3,
  invoiceDueDays: 7,
  biometricRetentionDays: 90,
  classBookingCutoffMinutes: 60,
  requireFullPaymentBeforeActivation: false,
  timezone: 'Asia/Karachi',
  currencyCode: 'PKR',
  updatedAt: '2026-10-01T05:00:00.000Z',
};

function renderSettings(role: Role) {
  const patches: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Partial<GymSettingsDto>;
        patches.push(body);
        return { status: 200, body: { ...SETTINGS, ...body } };
      }
      if (url.includes('/settings')) return { status: 200, body: SETTINGS };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  renderWithProviders(<SettingsPage />, { me: fakeMe(role) });
  return patches;
}

describe('C1 full payment before activation', () => {
  it('is off by default and changes only after an Admin confirms', async () => {
    const patches = renderSettings('ADMIN');
    const user = userEvent.setup();
    const toggle = await screen.findByRole('switch', {
      name: 'Require full payment before activation',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);
    const dialog = await screen.findByRole('dialog', { name: 'Require full payment?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(patches).toHaveLength(0);

    await user.click(toggle);
    const again = await screen.findByRole('dialog', { name: 'Require full payment?' });
    await user.type(within(again).getByLabelText(/Reason/), 'Too many unpaid renewals');
    await user.click(within(again).getByRole('button', { name: 'Turn on' }));
    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      requireFullPaymentBeforeActivation: true,
      reason: 'Too many unpaid renewals',
    });
    await vi.waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('is read-only for a Manager', async () => {
    renderSettings('MANAGER');
    const toggle = await screen.findByRole('switch', {
      name: 'Require full payment before activation',
    });
    expect(toggle).toBeDisabled();
  });
});

describe('PortalPaymentsPage', () => {
  it('shows what the member owes, their invoices and receipts, and online pay as not set up', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch((url) => {
        if (url.includes('/me/invoices'))
          return {
            status: 200,
            body: {
              data: [
                {
                  id: INVOICE.id,
                  invoiceNumber: INVOICE.invoiceNumber,
                  description: INVOICE.description,
                  amountDueMinor: 800_000,
                  paidMinor: 300_000,
                  balanceMinor: 500_000,
                  dueDate: '2026-10-08',
                  status: 'OVERDUE',
                  createdAt: INVOICE.createdAt,
                },
              ],
              page: 1,
              pageSize: 10,
              total: 1,
              summary: { outstandingMinor: 500_000, overdueMinor: 500_000 },
            },
          };
        if (url.includes('/me/payments'))
          return {
            status: 200,
            body: {
              data: [
                {
                  id: 'p1',
                  receiptNumber: 'RCP-000007',
                  invoiceNumber: INVOICE.invoiceNumber,
                  description: INVOICE.description,
                  amountMinor: 300_000,
                  refundedMinor: 0,
                  method: 'CASH',
                  status: 'COMPLETED',
                  receivedAt: '2026-10-02T06:30:00.000Z',
                },
              ],
              page: 1,
              pageSize: 10,
              total: 1,
            },
          };
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
      }),
    );
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithProviders(<PortalPaymentsPage />, { me: fakeMe('MEMBER') });
    const user = userEvent.setup();

    expect(await screen.findByText(/of it is overdue/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pay online' })).toBeDisabled();
    expect(screen.getByText('Requires configuration')).toBeVisible();
    const invoices = await screen.findByRole('list', { name: 'My invoices' });
    expect(within(invoices).getByText('Overdue')).toBeVisible();

    await user.click(await screen.findByRole('button', { name: 'Receipt RCP-000007' }));
    expect(open).toHaveBeenCalledWith('/portal/payments/p1/receipt', '_blank', 'noopener');
  });
});
