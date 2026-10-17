import type { DurationUnit, MembershipStatus } from './enums';

/**
 * Membership rules shared by the server (which enforces them) and the web app (which only uses
 * them to show the right buttons). Dates are calendar days, YYYY-MM-DD, in gym time (PLAN §3.3).
 */

/** Statuses that hold a period: they may not overlap for one member (exclusion constraint). */
export const CURRENT_MEMBERSHIP_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const;

export function isCurrentStatus(status: MembershipStatus): boolean {
  return (CURRENT_MEMBERSHIP_STATUSES as readonly MembershipStatus[]).includes(status);
}

/** PLAN §3.3. CANCELLED and EXPIRED are terminal; a renewal continues with a new row. */
export const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'CANCELLED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: MembershipStatus, to: MembershipStatus): boolean {
  return MEMBERSHIP_TRANSITIONS[from].includes(to);
}

export type MembershipAction =
  'activate' | 'renew' | 'extend' | 'suspend' | 'reactivate' | 'cancel';

/**
 * Which actions a membership in this status accepts.
 * - Extending changes dates only, so any period that still holds days can be extended.
 * - Renewal continues from an active or finished membership. A pending one must be activated
 *   first, and a suspended one reactivated first (its end date may still move).
 */
export function membershipActions(status: MembershipStatus): MembershipAction[] {
  const actions: MembershipAction[] = [];
  if (canTransition(status, 'ACTIVE'))
    actions.push(status === 'PENDING' ? 'activate' : 'reactivate');
  if (canTransition(status, 'SUSPENDED')) actions.push('suspend');
  if (status === 'ACTIVE' || status === 'EXPIRED' || status === 'CANCELLED') actions.push('renew');
  if (isCurrentStatus(status)) actions.push('extend');
  if (canTransition(status, 'CANCELLED')) actions.push('cancel');
  return actions;
}

/**
 * The status to show and to decide on today. An ACTIVE membership whose last day has passed is
 * expired even before the nightly job flips it (PLAN §6: never rely on the job having run).
 */
export function effectiveMembershipStatus(
  membership: { status: MembershipStatus; endDate: string },
  today: string,
): MembershipStatus {
  if (membership.status === 'ACTIVE' && membership.endDate < today) return 'EXPIRED';
  return membership.status;
}

// --- Calendar-day arithmetic ----------------------------------------------------------------
// Plain UTC arithmetic on date-only values: no time of day, so no DST or timezone drift.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(isoDate: string): Date {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new Error(`Not an ISO date: ${isoDate}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = parse(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return format(date);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Last day (inclusive) of a membership that starts on `startDate`.
 * - DAY: a 30-day plan from 1 March ends on 30 March.
 * - MONTH: the day before the same day-of-month N months later (15 Jan + 1 month → 14 Feb).
 *   When that day does not exist, the period runs to the end of the shorter month
 *   (31 Jan + 1 month → 28/29 Feb), so a membership is never cut short.
 */
export function computeEndDate(startDate: string, value: number, unit: DurationUnit): string {
  if (!Number.isInteger(value) || value < 1) throw new Error('Duration must be a positive integer');
  if (unit === 'DAY') return addDays(startDate, value - 1);

  const start = parse(startDate);
  const monthIndex = start.getUTCMonth() + value;
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = start.getUTCDate();
  const lastDay = daysInMonth(year, month);
  if (day > lastDay) return format(new Date(Date.UTC(year, month, lastDay)));
  return addDays(format(new Date(Date.UTC(year, month, day))), -1);
}

/**
 * A renewal starts the day after the member's latest current end date, or today when that date
 * has already passed or there is no current membership (PLAN §3.3).
 */
export function renewalStartDate(latestCurrentEndDate: string | null, today: string): string {
  if (latestCurrentEndDate === null || latestCurrentEndDate < today) return today;
  return addDays(latestCurrentEndDate, 1);
}

/** Days lost to a suspension that began on `suspendedOn` and ends today (today is usable again). */
export function suspendedDays(suspendedOn: string, today: string): number {
  return Math.max(0, daysBetween(suspendedOn, today));
}

/** Limits on dates staff may choose (the server re-checks them against gym time). */
export const MEMBERSHIP_LIMITS = {
  /** A membership may be recorded as having started up to this many days ago. */
  maxBackdateDays: 30,
  /** …or booked up to this many days ahead. */
  maxAdvanceDays: 365,
  /** One extension adds at most this many days. */
  maxExtendDays: 365,
  /** Upper bound for "expiring within N days" filters. */
  maxExpiringWithinDays: 90,
} as const;
