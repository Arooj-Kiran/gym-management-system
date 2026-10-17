import { describe, expect, it } from 'vitest';
import {
  addDays,
  assignMembershipSchema,
  canTransition,
  computeEndDate,
  daysBetween,
  effectiveMembershipStatus,
  extendMembershipSchema,
  MEMBERSHIP_STATUSES,
  membershipActions,
  membershipListQuerySchema,
  reactivateMembershipSchema,
  renewalStartDate,
  suspendedDays,
  suspendMembershipSchema,
  type MembershipStatus,
} from '../src';

describe('computeEndDate (inclusive periods)', () => {
  it('counts day plans inclusively', () => {
    expect(computeEndDate('2026-03-01', 1, 'DAY')).toBe('2026-03-01');
    expect(computeEndDate('2026-03-01', 30, 'DAY')).toBe('2026-03-30');
    expect(computeEndDate('2026-12-20', 15, 'DAY')).toBe('2027-01-03');
  });

  it('ends a month plan the day before the same date next month', () => {
    expect(computeEndDate('2026-01-15', 1, 'MONTH')).toBe('2026-02-14');
    expect(computeEndDate('2026-03-01', 1, 'MONTH')).toBe('2026-03-31');
    expect(computeEndDate('2026-10-17', 3, 'MONTH')).toBe('2027-01-16');
    expect(computeEndDate('2026-07-10', 6, 'MONTH')).toBe('2027-01-09');
    expect(computeEndDate('2026-10-17', 12, 'MONTH')).toBe('2027-10-16');
  });

  it('runs to the end of a shorter month instead of cutting the period short', () => {
    expect(computeEndDate('2026-01-31', 1, 'MONTH')).toBe('2026-02-28');
    expect(computeEndDate('2028-01-31', 1, 'MONTH')).toBe('2028-02-29'); // leap year
    expect(computeEndDate('2026-01-29', 1, 'MONTH')).toBe('2026-02-28');
    expect(computeEndDate('2026-01-28', 1, 'MONTH')).toBe('2026-02-27');
    expect(computeEndDate('2026-08-31', 1, 'MONTH')).toBe('2026-09-30');
    expect(computeEndDate('2026-12-31', 2, 'MONTH')).toBe('2027-02-28');
  });

  it('crosses year boundaries and supports long custom plans', () => {
    expect(computeEndDate('2026-11-15', 3, 'MONTH')).toBe('2027-02-14');
    expect(computeEndDate('2026-01-01', 120, 'MONTH')).toBe('2035-12-31');
    expect(computeEndDate('2026-01-01', 365, 'DAY')).toBe('2026-12-31');
  });

  it('rejects a non-positive duration', () => {
    expect(() => computeEndDate('2026-01-01', 0, 'DAY')).toThrow();
    expect(() => computeEndDate('2026-01-01', 1.5, 'MONTH')).toThrow();
  });
});

describe('day arithmetic', () => {
  it('adds and counts days across month, year and DST-prone dates', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', -30)).toBe('2026-02-27');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-17', '2026-10-10')).toBe(-7);
  });

  it('counts suspended days up to (not including) the day of reactivation', () => {
    expect(suspendedDays('2026-10-10', '2026-10-17')).toBe(7);
    expect(suspendedDays('2026-10-17', '2026-10-17')).toBe(0);
    expect(suspendedDays('2026-10-18', '2026-10-17')).toBe(0);
  });
});

describe('renewalStartDate', () => {
  it('starts the day after the latest current end date', () => {
    expect(renewalStartDate('2026-10-31', '2026-10-17')).toBe('2026-11-01');
    expect(renewalStartDate('2026-10-17', '2026-10-17')).toBe('2026-10-18');
  });

  it('starts today when that date has passed or there is none', () => {
    expect(renewalStartDate('2026-10-16', '2026-10-17')).toBe('2026-10-17');
    expect(renewalStartDate(null, '2026-10-17')).toBe('2026-10-17');
  });
});

describe('status transitions (PLAN §3.3)', () => {
  const allowed: [MembershipStatus, MembershipStatus][] = [
    ['PENDING', 'ACTIVE'],
    ['PENDING', 'CANCELLED'],
    ['ACTIVE', 'SUSPENDED'],
    ['ACTIVE', 'CANCELLED'],
    ['ACTIVE', 'EXPIRED'],
    ['SUSPENDED', 'ACTIVE'],
    ['SUSPENDED', 'CANCELLED'],
  ];

  it('allows exactly the listed transitions', () => {
    for (const from of MEMBERSHIP_STATUSES) {
      for (const to of MEMBERSHIP_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it('treats cancelled and expired as terminal', () => {
    expect(membershipActions('CANCELLED')).toEqual(['renew']);
    expect(membershipActions('EXPIRED')).toEqual(['renew']);
  });

  it('offers the actions each status accepts', () => {
    expect(membershipActions('PENDING')).toEqual(['activate', 'extend', 'cancel']);
    expect(membershipActions('ACTIVE')).toEqual(['suspend', 'renew', 'extend', 'cancel']);
    expect(membershipActions('SUSPENDED')).toEqual(['reactivate', 'extend', 'cancel']);
  });

  it('reads an ACTIVE membership past its end date as expired', () => {
    const active = { status: 'ACTIVE' as const, endDate: '2026-10-16' };
    expect(effectiveMembershipStatus(active, '2026-10-17')).toBe('EXPIRED');
    expect(effectiveMembershipStatus(active, '2026-10-16')).toBe('ACTIVE');
    expect(effectiveMembershipStatus({ ...active, status: 'SUSPENDED' }, '2026-10-17')).toBe(
      'SUSPENDED',
    );
  });
});

describe('membership schemas', () => {
  const ids = {
    memberId: '6f1c9a52-6a43-4c1e-9b7a-0d8a3f6b2c11',
    planId: '0b6f3d2e-41c8-4a4f-8f0e-5a2b9c7d1e33',
  };

  it('assign: start date is optional and unknown fields are rejected', () => {
    expect(assignMembershipSchema.parse(ids).startDate).toBeNull();
    expect(assignMembershipSchema.parse({ ...ids, startDate: '2026-10-20' }).startDate).toBe(
      '2026-10-20',
    );
    expect(assignMembershipSchema.safeParse({ ...ids, endDate: '2027-01-01' }).success).toBe(false);
    expect(assignMembershipSchema.safeParse({ ...ids, status: 'ACTIVE' }).success).toBe(false);
    expect(assignMembershipSchema.safeParse({ ...ids, priceMinor: 1 }).success).toBe(false);
  });

  it('status changes need a reason', () => {
    expect(suspendMembershipSchema.safeParse({}).success).toBe(false);
    expect(suspendMembershipSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(suspendMembershipSchema.safeParse({ reason: 'Medical leave' }).success).toBe(true);
  });

  it('extend: 1–365 whole days', () => {
    const base = { reason: 'Gym closed for repairs' };
    expect(extendMembershipSchema.safeParse({ ...base, days: 0 }).success).toBe(false);
    expect(extendMembershipSchema.safeParse({ ...base, days: 1.5 }).success).toBe(false);
    expect(extendMembershipSchema.safeParse({ ...base, days: 366 }).success).toBe(false);
    expect(extendMembershipSchema.safeParse({ ...base, days: 7 }).success).toBe(true);
  });

  it('reactivate: the extension is off unless asked for', () => {
    expect(reactivateMembershipSchema.parse({ reason: 'Back from leave' })).toEqual({
      reason: 'Back from leave',
      extendBySuspendedDays: false,
    });
  });

  it('list query: coerces numbers and bounds the expiry window', () => {
    const parsed = membershipListQuerySchema.parse({ expiringWithinDays: '7', page: '2' });
    expect(parsed).toMatchObject({ expiringWithinDays: 7, page: 2, sort: 'endDate' });
    expect(membershipListQuerySchema.safeParse({ expiringWithinDays: '91' }).success).toBe(false);
    expect(membershipListQuerySchema.safeParse({ status: 'GONE' }).success).toBe(false);
  });
});
