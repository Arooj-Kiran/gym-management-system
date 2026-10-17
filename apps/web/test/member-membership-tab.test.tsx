import { addDays, type MemberDto, type MembershipDto, type Role } from '@gms/shared';
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
    ...overrides,
  };
}

function setup(role: Role, rows: MembershipDto[]) {
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
        return { status: 200, body: { data: [] } };
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
    expect(posts[0]!.body).toEqual({ reason: 'Moved to another city', version: 3 });
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
