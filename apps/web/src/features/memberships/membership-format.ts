import {
  daysBetween,
  isCurrentStatus,
  type MembershipEventType,
  type MembershipStatus,
} from '@gms/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { formatDate } from '../../lib/format';

export const MEMBERSHIP_TONES: Record<MembershipStatus, BadgeTone> = {
  PENDING: 'primary',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CANCELLED: 'neutral',
  EXPIRED: 'danger',
};

export const MEMBERSHIP_EVENT_TONES: Record<MembershipEventType, BadgeTone> = {
  CREATED: 'primary',
  ACTIVATED: 'success',
  RENEWED: 'success',
  EXTENDED: 'primary',
  SUSPENDED: 'warning',
  REACTIVATED: 'success',
  CANCELLED: 'danger',
  EXPIRED: 'neutral',
};

export const membershipPeriod = (membership: { startDate: string; endDate: string }) =>
  `${formatDate(membership.startDate)} – ${formatDate(membership.endDate)}`;

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * How the period relates to today, in words: "Starts in 3 days", "12 days left",
 * "Last day today", "Ended 4 days ago". The end date is inclusive.
 */
export function membershipTiming(
  membership: { startDate: string; endDate: string; effectiveStatus: MembershipStatus },
  today: string,
) {
  const { startDate, endDate, effectiveStatus } = membership;
  if (effectiveStatus === 'CANCELLED') return null;
  if (startDate > today) {
    const days = daysBetween(today, startDate);
    return days === 1 ? 'Starts tomorrow' : `Starts in ${plural(days, 'day')}`;
  }
  if (endDate < today) {
    const days = daysBetween(endDate, today);
    return days === 1 ? 'Ended yesterday' : `Ended ${plural(days, 'day')} ago`;
  }
  const left = daysBetween(today, endDate) + 1;
  return left === 1 ? 'Last day today' : `${plural(left, 'day')} left`;
}

/** The calendar date of a timestamp in gym time (YYYY-MM-DD). */
export function gymDateOf(iso: string, timeZone = 'Asia/Karachi') {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

/**
 * The membership a member is "on", by the same rule as the server: a pending/active/suspended
 * period that has started, else one that is still to come, else the most recent one.
 */
export function pickCurrentMembership<T extends { status: MembershipStatus; startDate: string }>(
  rows: T[],
  today: string,
): T | null {
  const rank = (row: T) => (isCurrentStatus(row.status) ? (row.startDate <= today ? 0 : 1) : 2);
  return (
    [...rows].sort((a, b) => rank(a) - rank(b) || b.startDate.localeCompare(a.startDate))[0] ?? null
  );
}

/** A period already lined up after `current` (a renewal or an advance booking). */
export function pickNextMembership<
  T extends { id: string; status: MembershipStatus; startDate: string },
>(rows: T[], current: { id: string; endDate: string } | null): T | null {
  if (!current) return null;
  return (
    rows
      .filter(
        (row) =>
          row.id !== current.id && isCurrentStatus(row.status) && row.startDate > current.endDate,
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
  );
}
