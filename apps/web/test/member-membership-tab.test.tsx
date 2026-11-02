import {
  addDays,
  type MemberDto,
  type MembershipDto,
  type MembershipEventDto,
  type MembershipInvoiceBrief,
  type Role,
} from '@gms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemberMembershipTab } from '../src/features/memberships/member-membership-tab';
import { gymTodayIso } from '../src/lib/format';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const TODAY = gymTodayIso();

const MEMBER = {
  id: '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  memberCode: 'M-00021',
  firstName: 'Sana',
  lastName: 'Qureshi',
  archivedAt: null,
} as MemberDto;

function membership(overrides: Partial<MembershipDto> = {}): MembershipDto {
  return {
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    memberId: MEMBER.id,
    planId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    planName: 'Monthly Unlimited',
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    startDate: addDays(TODAY, -10),
    endDate: addDays(TODAY, 19),
    priceMinor: 800_000,
    accessDays: null,
    accessStartTime: null,
    accessEndTime: null,
    activatedAt: '2026-10-07T05:00:00.000Z',
    suspendedAt: null,
    suspensionReason: null,
    cancelledAt: null,
    cancellationReason: null,
    totalSuspendedDays: 0,
    renewedFromId: null,
    version: 3,
    createdAt: '2026-10-07T05:00:00.000Z',
    updatedAt: '2026-10-07T05:00:00.000Z',
    member: { ...MEMBER, photoUrl: null },
    invoice: null,
    ...overrides,
  };
}

function invoice(overrides: Partial<MembershipInvoiceBrief> = {}): MembershipInvoiceBrief {
  return {
    id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
    invoiceNumber: 'INV-000014',
    status: 'PENDING',
    amountDueMinor: 800_000,
    balanceMinor: 800_000,
    dueDate: addDays(TODAY, -10),
    ...overrides,
  };
}

function setup(role: Role, rows: MembershipDto[], events: MembershipEventDto[] = []) {
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return { status: 200, body: { ...rows[0], status: 'CANCELLED' } };
      }
      if (url.includes(`/members/${MEMBER.id}/memberships`))
        return { status: 200, body: { data: rows } };
      if (url.includes(`/members/${MEMBER.id}/membership-events`))
        return { status: 200, body: { data: events } };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  renderWithProviders(<MemberMembershipTab member={MEMBER} />, { me: fakeMe(role) });
  return posts;
}

async function actionLabels() {
  const current = await screen.findByRole('region', { name: 'Current membership' });
  return within(current)
    .queryAllByRole('button')
    .map((button) => button.textContent?.trim());
}

describe('MemberMembershipTab', () => {
  it('gives a manager every action on an active membership', async () => {
    setup('MANAGER', [membership()]);
    expect(await actionLabels()).toEqual(['Suspend', 'Renew', 'Extend', 'Cancel membership']);
    expect(screen.getByText('20 days left', { exact: false })).toBeVisible();
  });

  it('limits the front desk to renewing, and to activating a pending period', async () => {
    setup('RECEPTIONIST', [membership()]);
    expect(await actionLabels()).toEqual(['Renew']);
  });

  it('lets the front desk activate a pending period that has not ended', async () => {
    setup('RECEPTIONIST', [membership({ status: 'PENDING', effectiveStatus: 'PENDING' })]);
    expect(await actionLabels()).toEqual(['Activate']);
  });

  it('cancels only with a reason, sending the version it was shown', async () => {
    const posts = setup('ADMIN', [membership()]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel membership' }));

    const dialog = await screen.findByRole('dialog', { name: /Cancel Sana Qureshi's membership/ });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel membership' }));
    expect(posts).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), 'Moved to another city');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel membership' }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toContain(`/memberships/${membership().id}/cancel`);
    // A free plan has no invoice, so there is nothing to offer to void.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(posts[0]!.body).toEqual({
      reason: 'Moved to another city',
      voidUnpaidInvoice: false,
      version: 3,
    });
  });

  async function openCancel(role: Role, row: MembershipDto) {
    const posts = setup(role, [row]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel membership' }));
    const dialog = await screen.findByRole('dialog', { name: /Cancel Sana Qureshi's membership/ });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Moved to another city');
    return { posts, user, dialog };
  }

  it('voids the unpaid invoice with the cancellation by default', async () => {
    const { posts, user, dialog } = await openCancel('MANAGER', membership({ invoice: invoice() }));
    const box = within(dialog).getByRole('checkbox', {
      name: /Also void its unpaid invoice INV-000014/,
    });
    expect(box).toBeChecked();
    expect(within(dialog).getByText('Sana Qureshi will no longer owe it.')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel membership' }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ voidUnpaidInvoice: true, version: 3 });
  });

  it('keeps the invoice owed when the box is unticked', async () => {
    const { posts, user, dialog } = await openCancel('ADMIN', membership({ invoice: invoice() }));
    await user.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).getByText('The invoice stays open and is still owed.')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel membership' }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ voidUnpaidInvoice: false });
  });

  it('does not offer to void an invoice that has money paid on it', async () => {
    const partlyPaid = invoice({ status: 'PARTIALLY_PAID', balanceMinor: 300_000 });
    const { posts, user, dialog } = await openCancel(
      'MANAGER',
      membership({ invoice: partlyPaid }),
    );
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).getByText(/INV-000014 has .*5,000.* paid on it/)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel membership' }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ voidUnpaidInvoice: false });
  });

  it('does not offer to void an invoice that is already void', async () => {
    const { dialog } = await openCancel(
      'MANAGER',
      membership({ invoice: invoice({ status: 'VOID' }) }),
    );
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByText(/paid on it/)).toBeNull();
  });

  it('notes a voided invoice in the cancellation history', async () => {
    const row = membership({ status: 'CANCELLED', effectiveStatus: 'CANCELLED' });
    setup(
      'MANAGER',
      [row],
      [
        {
          id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
          membershipId: row.id,
          planName: row.planName,
          eventType: 'CANCELLED',
          fromStatus: 'ACTIVE',
          toStatus: 'CANCELLED',
          oldValues: null,
          newValues: {
            startDate: row.startDate,
            endDate: row.endDate,
            voidedInvoice: 'INV-000014',
          },
          reason: 'Moved to another city',
          actorName: 'Omar Farooq',
          createdAt: '2026-10-28T09:00:00.000Z',
        },
      ],
    );
    const history = await screen.findByRole('list', { name: 'Membership history' });
    expect(within(history).getByText(/invoice INV-000014 voided/)).toBeVisible();
  });

  it('offers to assign a plan when the member has none', async () => {
    setup('RECEPTIONIST', []);
    expect(await screen.findByText('No membership yet')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assign membership' })).toBeVisible();
  });

  it('shows a trainer the membership without any actions', async () => {
    setup('TRAINER', []);
    expect(await screen.findByText('No membership yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Assign membership' })).toBeNull();
  });
});
