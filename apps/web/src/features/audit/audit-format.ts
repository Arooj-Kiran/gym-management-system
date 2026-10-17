import {
  AUDIT_ACTION_LABELS,
  MEMBER_ACCOUNT_STATUS_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  PLAN_TYPE_LABELS,
  ROLE_LABELS,
  type AuditAction,
  type AuditLogDto,
} from '@gms/shared';
import type { BadgeTone } from '../../components/ui/badge';

const TONES: Partial<Record<AuditAction, BadgeTone>> = {
  LOGIN_FAILED: 'warning',
  ACCOUNT_LOCKED: 'danger',
  STAFF_DEACTIVATED: 'danger',
  STAFF_PASSWORD_RESET: 'warning',
  ROLE_CHANGED: 'primary',
  SETTINGS_CHANGED: 'primary',
  STAFF_CREATED: 'success',
  STAFF_ACTIVATED: 'success',
  MEMBER_CREATED: 'success',
  MEMBER_RESTORED: 'success',
  MEMBER_ARCHIVED: 'danger',
  MEMBER_ACCESS_BLOCKED: 'danger',
  MEMBER_ACCESS_UNBLOCKED: 'success',
  MEMBER_DUPLICATE_PHONE_CONFIRMED: 'warning',
  MEMBER_PORTAL_ACCOUNT_CREATED: 'primary',
  PLAN_CREATED: 'success',
  PLAN_ARCHIVED: 'danger',
  PLAN_UNARCHIVED: 'success',
  MEMBERSHIP_ASSIGNED: 'primary',
  MEMBERSHIP_ACTIVATED: 'success',
  MEMBERSHIP_RENEWED: 'success',
  MEMBERSHIP_EXTENDED: 'primary',
  MEMBERSHIP_SUSPENDED: 'warning',
  MEMBERSHIP_REACTIVATED: 'success',
  MEMBERSHIP_CANCELLED: 'danger',
  MEMBERSHIP_EXPIRED: 'neutral',
};

export const auditTone = (action: AuditAction): BadgeTone => TONES[action] ?? 'neutral';
export const auditLabel = (action: AuditAction) => AUDIT_ACTION_LABELS[action] ?? action;

/** "Ayesha Malik" or a sensible stand-in for system and anonymous events. */
export function auditActorName(event: AuditLogDto) {
  if (event.actor) return event.actor.name;
  if (event.userAgent === 'seed') return 'Demo data seed';
  if (event.action === 'LOGIN_FAILED')
    return typeof event.after?.email === 'string' ? event.after.email : 'Unknown';
  return 'System';
}

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  jobTitle: 'Job title',
  hireDate: 'Hire date',
  notes: 'Notes',
  role: 'Role',
  isActive: 'Active',
  gymName: 'Gym name',
  expiryReminderDays: 'Expiry reminder (days)',
  paymentDueReminderDays: 'Payment reminder (days)',
  invoiceDueDays: 'Invoice due (days)',
  biometricRetentionDays: 'Biometric retention (days)',
  classBookingCutoffMinutes: 'Class booking cut-off (min)',
  reason: 'Reason',
  lockedUntil: 'Locked until',
  failedAttempts: 'Failed attempts',
  sessionsRevoked: 'Sessions ended',
  otherSessionsRevoked: 'Other sessions ended',
  changeRequiredAtNextSignIn: 'Change at next sign-in',
  memberCode: 'Member code',
  emergencyContactName: 'Emergency contact',
  emergencyContactPhone: 'Emergency phone',
  emergencyContactRelation: 'Relationship',
  registrationDate: 'Registration date',
  accountStatus: 'Account status',
  archived: 'Archived',
  portalLoginDisabled: 'Portal login switched off',
  portalLoginEnabled: 'Portal login switched on',
  accessBlocked: 'Entry blocked',
  photo: 'Photo',
  contentType: 'File type',
  bytes: 'File size (bytes)',
  loginEmail: 'Login email',
  userId: 'Login account',
  matchedMemberIds: 'Matched member IDs',
  matchedMemberCodes: 'Matched members',
  sameNameMatch: 'Same name as well',
  name: 'Name',
  planType: 'Plan type',
  durationValue: 'Duration',
  durationUnit: 'Duration unit',
  priceMinor: 'Price (minor units)',
  description: 'Description',
  benefits: 'Benefits',
  allowPartialPayment: 'Partial payment allowed',
  accessDays: 'Access days',
  accessStartTime: 'Access from',
  accessEndTime: 'Access until',
  memberId: 'Member ID',
  planId: 'Plan ID',
  planName: 'Plan',
  previousPlanName: 'Previous plan',
  status: 'Status',
  previousStatus: 'Previous status',
  startDate: 'Start date',
  endDate: 'End date',
  previousEndDate: 'Previous end date',
  expiredOn: 'Expired on',
  days: 'Days added',
  suspendedAt: 'Suspended at',
  suspensionReason: 'Suspension reason',
  suspendedDays: 'Days suspended',
  extendedBySuspendedDays: 'End date pushed back',
  renewedFromId: 'Renewed from',
};

export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key;

const VALUE_LABELS: Record<string, string> = {
  ...ROLE_LABELS,
  ...MEMBER_ACCOUNT_STATUS_LABELS,
  ...MEMBERSHIP_STATUS_LABELS,
  ...PLAN_TYPE_LABELS,
  DAY: 'Days',
  MONTH: 'Months',
  UNKNOWN_ACCOUNT: 'No account with this email',
  BAD_PASSWORD: 'Wrong password',
  ACCOUNT_LOCKED: 'Account was locked',
  ACCOUNT_INACTIVE: 'Account is deactivated',
};

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return VALUE_LABELS[value] ?? value;
  if (typeof value === 'number') return String(value);
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' || typeof item === 'number')
  )
    return value.length === 0 ? '—' : value.join(', ');
  return JSON.stringify(value);
}
