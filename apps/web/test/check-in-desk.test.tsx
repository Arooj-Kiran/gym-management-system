import type { AccessDecision, MemberSummaryDto } from '@gms/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../src/api/query-keys';
import { CheckInDesk } from '../src/features/access/check-in-desk';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const MEMBER_ID = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const ATTEMPT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function member(status: 'ACTIVE' | 'EXPIRED' = 'ACTIVE'): MemberSummaryDto {
  return {
    id: MEMBER_ID,
    memberCode: 'GM-000001',
    firstName: 'Amina',
    lastName: 'Khan',
    email: null,
    phone: '+923001234567',
    photoUrl: null,
    registrationDate: '2026-01-01',
    accountStatus: 'ACTIVE',
    accessBlocked: false,
    hasPortalAccount: false,
    archivedAt: null,
    isDemo: false,
    createdAt: '2026-01-01T08:00:00.000Z',
    currentMembership: {
      id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      planName: 'Monthly Gym',
      status,
      effectiveStatus: status,
      startDate: '2026-01-01',
      endDate: status === 'ACTIVE' ? '2026-12-31' : '2026-01-31',
    },
  };
}

function decision(reason: AccessDecision['reason']): AccessDecision {
  const granted = reason === 'GRANTED';
  return {
    decision: granted ? 'GRANTED' : 'DENIED',
    reason,
    title: granted ? 'Access Granted' : 'Access Denied',
    message: granted ? 'Welcome to the gym.' : 'The membership has expired.',
    source: 'MANUAL',
    attemptId: ATTEMPT_ID,
    duplicate: false,
    occurredAt: '2026-11-02T10:00:00.000Z',
    deviceId: null,
    ...(granted
      ? {
          member: { firstName: 'Amina', memberCode: 'GM-000001', photoUrl: null },
          membership: { planName: 'Monthly Gym', endDate: '2026-12-31' },
        }
      : {}),
  };
}

function setup(accessDecision: AccessDecision) {
  const posts: { url: string; body: unknown }[] = [];
  const searchUrls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/members') && init?.method !== 'POST') {
        searchUrls.push(url);
        return {
          status: 200,
          body: {
            data: [member(accessDecision.reason === 'MEMBERSHIP_EXPIRED' ? 'EXPIRED' : 'ACTIVE')],
          },
        };
      }
      if (parsed.pathname.endsWith('/attendance/manual-check-in') && init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return { status: 200, body: accessDecision };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  const { queryClient } = renderWithProviders(<CheckInDesk />, { me: fakeMe('RECEPTIONIST') });
  queryClient.setQueryData([...queryKeys.attendance.all, 'test'], []);
  queryClient.setQueryData([...queryKeys.access.all, 'test'], []);
  return { posts, queryClient, searchUrls };
}

describe('CheckInDesk', () => {
  it('shows matching member details and checks the member in on selection', async () => {
    const { posts, queryClient, searchUrls } = setup(decision('GRANTED'));
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', {
      name: 'Search members by name, phone, or member code',
    });

    await user.type(input, 'GM-000001');

    const option = await screen.findByRole('option');
    expect(within(option).getByText('Amina Khan')).toBeVisible();
    expect(within(option).getByText('GM-000001')).toBeVisible();
    expect(within(option).getByText('+923001234567')).toBeVisible();
    expect(within(option).getByText('Active')).toBeVisible();
    await user.click(option);

    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
    expect(searchUrls.some((url) => url.includes('q=GM-000001'))).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      url: expect.stringContaining('/attendance/manual-check-in'),
      body: { memberId: MEMBER_ID, reason: 'Manual Desk Entry' },
    });
    await waitFor(() => {
      expect(queryClient.getQueryState([...queryKeys.attendance.all, 'test'])?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState([...queryKeys.access.all, 'test'])?.isInvalidated).toBe(
        true,
      );
    });
  });

  it('submits the highlighted result on Enter and shows a denial without clearing search', async () => {
    setup(decision('MEMBERSHIP_EXPIRED'));
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', {
      name: 'Search members by name, phone, or member code',
    });

    await user.type(input, '+923001234567');
    const option = await screen.findByRole('option');
    expect(within(option).getByText('Expired')).toBeVisible();
    await user.keyboard('{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Access denied. Expired: The membership has expired.');
    expect(input).toHaveValue('+923001234567');
  });
});
