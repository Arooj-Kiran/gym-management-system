import { CURRENT_MEMBERSHIP_STATUSES, type AccessReason, type MembershipStatus } from '@gms/shared';

/**
 * PLAN §6.3 steps 6–8 as a pure function: who may enter right now. Every input comes from rows
 * the decision transaction has locked, and "now" is always the server clock in the gym timezone.
 */

export interface EligibilityMember {
  archived: boolean;
  accountStatus: 'ACTIVE' | 'INACTIVE';
  accessBlocked: boolean;
}

export interface EligibilityMembership {
  id: string;
  status: MembershipStatus;
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  endDate: string;
  /** ISO weekdays (1 = Monday); null = every day. */
  accessDays: number[] | null;
  /** HH:MM or HH:MM:SS; both null = all opening hours. */
  accessStartTime: string | null;
  accessEndTime: string | null;
  createdAt: Date;
}

export interface GymNow {
  /** YYYY-MM-DD in the gym timezone. */
  date: string;
  /** 1 = Monday … 7 = Sunday, in the gym timezone. */
  isoWeekday: number;
  /** HH:MM in the gym timezone. */
  time: string;
}

export type Eligibility =
  | { eligible: true; reason: 'GRANTED'; membership: EligibilityMembership }
  | {
      eligible: false;
      reason: Exclude<AccessReason, 'GRANTED'>;
      /** The membership the denial is about, if any (its end date goes on the kiosk). */
      membership: EligibilityMembership | null;
    };

const isCurrentStatus = (status: MembershipStatus) =>
  (CURRENT_MEMBERSHIP_STATUSES as readonly string[]).includes(status);

const hhmm = (value: string) => value.slice(0, 5);

/** Access days and hours of the membership's plan snapshot. The end time is exclusive. */
export function withinAccessHours(membership: EligibilityMembership, now: GymNow): boolean {
  if (membership.accessDays && !membership.accessDays.includes(now.isoWeekday)) return false;
  const { accessStartTime: start, accessEndTime: end } = membership;
  if (start === null || end === null) return true;
  return hhmm(start) <= now.time && now.time < hhmm(end);
}

const newestFirst = (a: EligibilityMembership, b: EligibilityMembership) =>
  b.createdAt.getTime() - a.createdAt.getTime();

/**
 * The membership a denial should talk about, in this order:
 * 1. one whose period covers today (whatever its status),
 * 2. the next pending / active / suspended period still to come,
 * 3. the most recent period that has ended,
 * 4. a future period that was cancelled.
 * Ties go to the newest row.
 */
export function mostRelevantMembership(
  memberships: EligibilityMembership[],
  today: string,
): EligibilityMembership | null {
  const covering = memberships
    .filter((m) => m.startDate <= today && today <= m.endDate)
    .sort((a, b) => {
      // A live period outranks a cancelled one over the same days.
      const rank = (m: EligibilityMembership) => (m.status === 'CANCELLED' ? 1 : 0);
      return rank(a) - rank(b) || newestFirst(a, b);
    });
  if (covering[0]) return covering[0];

  const upcoming = memberships
    .filter((m) => m.startDate > today && isCurrentStatus(m.status))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || newestFirst(a, b));
  if (upcoming[0]) return upcoming[0];

  const past = memberships
    .filter((m) => m.endDate < today)
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || newestFirst(a, b));
  if (past[0]) return past[0];

  const futureCancelled = memberships
    .filter((m) => m.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || newestFirst(a, b));
  return futureCancelled[0] ?? null;
}

function denialFor(
  membership: EligibilityMembership,
  today: string,
): Exclude<AccessReason, 'GRANTED'> {
  switch (membership.status) {
    case 'CANCELLED':
      return 'MEMBERSHIP_CANCELLED';
    case 'SUSPENDED':
      return 'MEMBERSHIP_SUSPENDED';
    case 'EXPIRED':
      return 'MEMBERSHIP_EXPIRED';
    case 'PENDING':
      return 'MEMBERSHIP_NOT_ACTIVATED';
    case 'ACTIVE':
      // Read from the dates, so a missed nightly expiry run never lets anyone in.
      return membership.endDate < today ? 'MEMBERSHIP_EXPIRED' : 'MEMBERSHIP_NOT_STARTED';
  }
}

export function evaluateEligibility(
  member: EligibilityMember,
  memberships: EligibilityMembership[],
  now: GymNow,
): Eligibility {
  if (member.archived || member.accountStatus !== 'ACTIVE') {
    return { eligible: false, reason: 'MEMBER_INACTIVE', membership: null };
  }
  if (member.accessBlocked) return { eligible: false, reason: 'ACCESS_BLOCKED', membership: null };

  const active = memberships
    .filter((m) => m.status === 'ACTIVE' && m.startDate <= now.date && now.date <= m.endDate)
    .sort(newestFirst);
  if (active.length > 0) {
    const allowedNow = active.find((m) => withinAccessHours(m, now));
    if (allowedNow) return { eligible: true, reason: 'GRANTED', membership: allowedNow };
    return { eligible: false, reason: 'OUTSIDE_ACCESS_HOURS', membership: active[0]! };
  }

  const relevant = mostRelevantMembership(memberships, now.date);
  if (!relevant) return { eligible: false, reason: 'NO_MEMBERSHIP', membership: null };
  return { eligible: false, reason: denialFor(relevant, now.date), membership: relevant };
}

/** Today, weekday and time of day in `timeZone`. */
export function gymNow(timeZone: string, at = new Date()): GymNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    isoWeekday: weekdays.indexOf(parts.weekday!) + 1,
    time: `${parts.hour}:${parts.minute}`,
  };
}
