import type { MembershipStatus } from '@gms/shared';
import { describe, expect, it } from 'vitest';
import {
  membershipTiming,
  pickCurrentMembership,
  pickNextMembership,
} from '../src/features/memberships/membership-format';

const TODAY = '2026-10-17';

const row = (id: string, status: MembershipStatus, startDate: string, endDate: string) => ({
  id,
  status,
  effectiveStatus: status,
  startDate,
  endDate,
});

describe('membershipTiming', () => {
  it.each([
    [row('a', 'PENDING', '2026-10-18', '2026-11-17'), 'Starts tomorrow'],
    [row('a', 'PENDING', '2026-10-20', '2026-11-19'), 'Starts in 3 days'],
    [row('a', 'ACTIVE', '2026-10-01', '2026-10-17'), 'Last day today'],
    // The end date is inclusive: the 18th is still a full day.
    [row('a', 'ACTIVE', '2026-10-01', '2026-10-18'), '2 days left'],
    [row('a', 'EXPIRED', '2026-09-01', '2026-10-16'), 'Ended yesterday'],
    [row('a', 'EXPIRED', '2026-09-01', '2026-10-13'), 'Ended 4 days ago'],
    [row('a', 'CANCELLED', '2026-10-01', '2026-10-31'), null],
  ])('%o → %s', (membership, expected) =>
    expect(membershipTiming(membership, TODAY)).toBe(expected),
  );
});

describe('pickCurrentMembership', () => {
  it('prefers a running period over a booked one and over history', () => {
    const rows = [
      row('next', 'ACTIVE', '2026-11-01', '2026-11-30'),
      row('now', 'ACTIVE', '2026-10-01', '2026-10-31'),
      row('old', 'EXPIRED', '2026-09-01', '2026-09-30'),
    ];
    expect(pickCurrentMembership(rows, TODAY)?.id).toBe('now');
  });

  it('falls back to an upcoming period, then to the most recent ended one', () => {
    const upcoming = [
      row('old', 'EXPIRED', '2026-09-01', '2026-09-30'),
      row('booked', 'PENDING', '2026-10-20', '2026-11-19'),
    ];
    expect(pickCurrentMembership(upcoming, TODAY)?.id).toBe('booked');

    const history = [
      row('older', 'EXPIRED', '2026-07-01', '2026-07-31'),
      row('cancelled', 'CANCELLED', '2026-09-01', '2026-09-30'),
    ];
    expect(pickCurrentMembership(history, TODAY)?.id).toBe('cancelled');
    expect(pickCurrentMembership([], TODAY)).toBeNull();
  });
});

describe('pickNextMembership', () => {
  it('returns the earliest live period that starts after the current one ends', () => {
    const current = row('now', 'ACTIVE', '2026-10-01', '2026-10-31');
    const rows = [
      row('later', 'PENDING', '2026-12-01', '2026-12-31'),
      row('cancelled', 'CANCELLED', '2026-11-01', '2026-11-30'),
      row('renewal', 'ACTIVE', '2026-11-01', '2026-11-30'),
      current,
    ];
    expect(pickNextMembership(rows, current)?.id).toBe('renewal');
    expect(pickNextMembership(rows, null)).toBeNull();
  });
});
