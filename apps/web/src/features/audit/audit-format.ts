import { AUDIT_ACTION_LABELS, ROLE_LABELS, type AuditAction, type AuditLogDto } from '@gms/shared';
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
};

export const auditTone = (action: AuditAction): BadgeTone => TONES[action] ?? 'neutral';
export const auditLabel = (action: AuditAction) => AUDIT_ACTION_LABELS[action] ?? action;

/** "Ayesha Malik" or a sensible stand-in for system and anonymous events. */
export function auditActorName(event: AuditLogDto) {
  if (event.actor) return event.actor.name;
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
};

export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key;

const VALUE_LABELS: Record<string, string> = {
  ...ROLE_LABELS,
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
  return JSON.stringify(value);
}
