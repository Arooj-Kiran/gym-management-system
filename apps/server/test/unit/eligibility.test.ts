import { describe, expect, it } from 'vitest';
import {
  evaluateEligibility,
  gymNow,
  mostRelevantMembership,
  withinAccessHours,
  type EligibilityMember,
  type EligibilityMembership,
  type GymNow,
} from '../../src/modules/access/eligibility';

const MEMBER: EligibilityMember = { archived: false, accountStatus: 'ACTIVE', accessBlocked: false };
// Monday 19 October 2026, 10:30 gym time.
const NOW: GymNow = { date: '2026-10-19', isoWeekday: 1, time: '10:30' };

let created = 0;
function membership(overrides: Partial<EligibilityMembership> = {}): EligibilityMembership {
  created += 1;
  return {
    id: `m${created}`,
    status: 'ACTIVE',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    accessDays: null,
    accessStartTime: null,
    accessEndTime: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, created)),
    ...overrides,
  };
}

const reasonOf = (list: EligibilityMembership[], member = MEMBER, now = NOW) =>
  evaluateEligibility(member, list, now).reason;

describe('evaluateEligibility', () => {
  it('grants an active membership that covers today', () => {
    const current = membership();
    const result = evaluateEligibility(MEMBER, [current], NOW);
    expect(result).toEqual({ eligible: true, reason: 'GRANTED', membership: current });
  });

  it('grants on the first and the last day of the period (inclusive dates)', () => {
    expect(reasonOf([membership({ startDate: NOW.date })])).toBe('GRANTED');
    expect(reasonOf([membership({ endDate: NOW.date })])).toBe('GRANTED');
  });

  it('checks the member before any membership', () => {
    const list = [membership()];
    expect(reasonOf(list, { ...MEMBER, archived: true })).toBe('MEMBER_INACTIVE');
    expect(reasonOf(list, { ...MEMBER, accountStatus: 'INACTIVE' })).toBe('MEMBER_INACTIVE');
    expect(reasonOf(list, { ...MEMBER, accessBlocked: true })).toBe('ACCESS_BLOCKED');
    // An inactive account wins over a block.
    expect(reasonOf(list, { ...MEMBER, accountStatus: 'INACTIVE', accessBlocked: true })).toBe(
      'MEMBER_INACTIVE',
    );
  });

  it('denies with no membership at all', () => {
    expect(evaluateEligibility(MEMBER, [], NOW)).toEqual({
      eligible: false,
      reason: 'NO_MEMBERSHIP',
      membership: null,
    });
  });

  it.each([
    ['CANCELLED', 'MEMBERSHIP_CANCELLED'],
    ['SUSPENDED', 'MEMBERSHIP_SUSPENDED'],
    ['EXPIRED', 'MEMBERSHIP_EXPIRED'],
    ['PENDING', 'MEMBERSHIP_NOT_ACTIVATED'],
  ] as const)('denies a %s membership covering today with %s', (status, reason) => {
    expect(reasonOf([membership({ status })])).toBe(reason);
  });

  it('reads expiry from the dates, so a missed expiry job never grants entry', () => {
    const lapsed = membership({ startDate: '2026-09-01', endDate: '2026-10-18' });
    expect(reasonOf([lapsed])).toBe('MEMBERSHIP_EXPIRED');
  });

  it('denies an active membership that starts tomorrow as not started', () => {
    expect(reasonOf([membership({ startDate: '2026-10-20', endDate: '2026-11-19' })])).toBe(
      'MEMBERSHIP_NOT_STARTED',
    );
  });

  it('grants when an active period covers today even if an older one was cancelled', () => {
    const cancelled = membership({ status: 'CANCELLED' });
    const active = membership({ startDate: '2026-10-10', endDate: '2026-11-09' });
    expect(reasonOf([cancelled, active])).toBe('GRANTED');
  });

  it('prefers the live period over a cancelled one with the same days', () => {
    const suspended = membership({ status: 'SUSPENDED' });
    const cancelled = membership({ status: 'CANCELLED' });
    expect(reasonOf([suspended, cancelled])).toBe('MEMBERSHIP_SUSPENDED');
  });

  it('reports the upcoming period before the expired one', () => {
    const expired = membership({ status: 'EXPIRED', startDate: '2026-09-01', endDate: '2026-09-30' });
    const pending = membership({ status: 'PENDING', startDate: '2026-10-25', endDate: '2026-11-24' });
    expect(reasonOf([expired, pending])).toBe('MEMBERSHIP_NOT_ACTIVATED');
  });

  describe('access days and hours', () => {
    const offPeak = (overrides: Partial<EligibilityMembership> = {}) =>
      membership({
        accessDays: [1, 2, 3, 4, 5],
        accessStartTime: '06:00:00',
        accessEndTime: '12:00:00',
        ...overrides,
      });

    it('grants inside the window and denies outside it', () => {
      expect(reasonOf([offPeak()])).toBe('GRANTED');
      expect(reasonOf([offPeak()], MEMBER, { ...NOW, time: '12:30' })).toBe(
        'OUTSIDE_ACCESS_HOURS',
      );
      expect(reasonOf([offPeak()], MEMBER, { ...NOW, isoWeekday: 6 })).toBe(
        'OUTSIDE_ACCESS_HOURS',
      );
    });

    it('treats the start as inclusive and the end as exclusive', () => {
      expect(withinAccessHours(offPeak(), { ...NOW, time: '06:00' })).toBe(true);
      expect(withinAccessHours(offPeak(), { ...NOW, time: '11:59' })).toBe(true);
      expect(withinAccessHours(offPeak(), { ...NOW, time: '12:00' })).toBe(false);
    });

    it('grants through any active period whose hours allow it', () => {
      const evening = offPeak({ accessStartTime: '17:00', accessEndTime: '22:00' });
      const anytime = membership({ startDate: '2026-10-15', endDate: '2026-11-14' });
      expect(reasonOf([evening, anytime])).toBe('GRANTED');
    });
  });
});

describe('mostRelevantMembership', () => {
  it('returns null for an empty list', () => {
    expect(mostRelevantMembership([], NOW.date)).toBeNull();
  });

  it('picks the most recent ended period', () => {
    const older = membership({ status: 'EXPIRED', startDate: '2026-07-01', endDate: '2026-07-31' });
    const newer = membership({ status: 'EXPIRED', startDate: '2026-08-01', endDate: '2026-08-31' });
    expect(mostRelevantMembership([older, newer], NOW.date)).toBe(newer);
  });

  it('falls back to a cancelled future period', () => {
    const future = membership({ status: 'CANCELLED', startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(mostRelevantMembership([future], NOW.date)).toBe(future);
  });
});

describe('gymNow', () => {
  it('converts an instant to the gym date, weekday and time', () => {
    // 19:30 UTC on Sunday 18 Oct is 00:30 on Monday 19 Oct in Karachi (UTC+5).
    expect(gymNow('Asia/Karachi', new Date('2026-10-18T19:30:00Z'))).toEqual({
      date: '2026-10-19',
      isoWeekday: 1,
      time: '00:30',
    });
  });

  it('reports midnight as 00:00, not 24:00', () => {
    expect(gymNow('UTC', new Date('2026-10-19T00:00:00Z')).time).toBe('00:00');
  });
});
