import { config } from '../../config/env';

/** Wording of every notification, in one place. Dates and times are shown in gym time. */

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatDateTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.gymTimezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

export function formatMoney(minor: number): string {
  const major = minor / 100;
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: config.currencyCode,
    currencyDisplay: 'code',
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

const dayWord = (days: number) =>
  days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

export const templates = {
  membershipExpiring: (plan: string, endDate: string, daysLeft: number) => ({
    title: 'Membership expiring soon',
    body: `Your ${plan} membership ends ${dayWord(daysLeft)} (${formatDate(endDate)}). Renew at the front desk to keep your access.`,
  }),
  membershipExpired: (plan: string, endDate: string) => ({
    title: 'Membership expired',
    body: `Your ${plan} membership ended on ${formatDate(endDate)}. Gym entry is paused until you renew.`,
  }),
  // Staff reasons are internal notes, so they are never copied into a member's notification.
  membershipCancelled: (plan: string) => ({
    title: 'Membership cancelled',
    body: `Your ${plan} membership has been cancelled and gym entry is closed. Please contact the front desk with any questions.`,
  }),
  membershipSuspended: (plan: string) => ({
    title: 'Membership suspended',
    body: `Your ${plan} membership is on hold. Gym entry is paused until it is reactivated.`,
  }),
  renewalSuccess: (plan: string, startDate: string, endDate: string, active: boolean) => ({
    title: 'Membership renewed',
    body: active
      ? `Your ${plan} membership is renewed from ${formatDate(startDate)} to ${formatDate(endDate)}.`
      : `Your ${plan} renewal (${formatDate(startDate)} to ${formatDate(endDate)}) is recorded and starts once payment is received.`,
  }),
  paymentDue: (invoiceNumber: string, balanceMinor: number, dueDate: string, daysLeft: number) => ({
    title: 'Payment due soon',
    body: `Invoice ${invoiceNumber}: ${formatMoney(balanceMinor)} is due ${dayWord(daysLeft)} (${formatDate(dueDate)}).`,
  }),
  paymentOverdue: (invoiceNumber: string, balanceMinor: number, dueDate: string) => ({
    title: 'Payment overdue',
    body: `Invoice ${invoiceNumber}: ${formatMoney(balanceMinor)} was due on ${formatDate(dueDate)}. Please pay at the front desk.`,
  }),
  classReminder: (className: string, startsAt: Date, room: string | null) => ({
    title: 'Class reminder',
    body: `${className} starts ${formatDateTime(startsAt)}${room ? ` in ${room}` : ''}. Cancel in the portal if you can't make it.`,
  }),
  appointmentReminder: (withName: string, startsAt: Date) => ({
    title: 'Appointment reminder',
    body: `Personal training with ${withName} on ${formatDateTime(startsAt)}.`,
  }),
  equipmentMaintenanceDue: (
    name: string,
    assetTag: string,
    nextDate: string,
    daysLeft: number,
  ) => ({
    title: daysLeft < 0 ? 'Equipment maintenance overdue' : 'Equipment maintenance due',
    body:
      daysLeft < 0
        ? `${name} (${assetTag}) was due for maintenance on ${formatDate(nextDate)}.`
        : `${name} (${assetTag}) is due for maintenance ${dayWord(daysLeft)} (${formatDate(nextDate)}).`,
  }),
  // Staff only (Admins and Managers): they confirm the deletion by revoking the enrollment.
  biometricRetentionDue: (
    name: string,
    memberCode: string,
    reason: 'ARCHIVED' | 'NO_MEMBERSHIP',
    since: string,
    retentionDays: number,
  ) => ({
    title: 'Fingerprint data review due',
    body: `${name} (${memberCode}) ${
      reason === 'ARCHIVED'
        ? `was archived on ${formatDate(since)}`
        : `has had no active membership since ${formatDate(since)}`
    }. The retention period is ${retentionDays} days: review their fingerprint on the member's page and revoke it unless they are coming back.`,
  }),
};
