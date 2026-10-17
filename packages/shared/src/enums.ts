/** Audit actions. Later stages append their own actions here. */
export const AUDIT_ACTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'ROLE_CHANGED',
  'STAFF_ACTIVATED',
  'STAFF_DEACTIVATED',
  'STAFF_PASSWORD_RESET',
  'SETTINGS_CHANGED',
  'MEMBER_CREATED',
  'MEMBER_UPDATED',
  'MEMBER_DUPLICATE_PHONE_CONFIRMED',
  'MEMBER_ARCHIVED',
  'MEMBER_RESTORED',
  'MEMBER_PHOTO_UPDATED',
  'MEMBER_PORTAL_ACCOUNT_CREATED',
  'MEMBER_ACCESS_BLOCKED',
  'MEMBER_ACCESS_UNBLOCKED',
  'MEMBER_PROFILE_SELF_UPDATED',
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'PLAN_ARCHIVED',
  'PLAN_UNARCHIVED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Sign-in failed',
  ACCOUNT_LOCKED: 'Account locked',
  LOGOUT: 'Signed out',
  PASSWORD_CHANGED: 'Password changed',
  STAFF_CREATED: 'Staff account created',
  STAFF_UPDATED: 'Staff details updated',
  ROLE_CHANGED: 'Role changed',
  STAFF_ACTIVATED: 'Staff account activated',
  STAFF_DEACTIVATED: 'Staff account deactivated',
  STAFF_PASSWORD_RESET: 'Password reset by admin',
  SETTINGS_CHANGED: 'Settings changed',
  MEMBER_CREATED: 'Member registered',
  MEMBER_UPDATED: 'Member details updated',
  MEMBER_DUPLICATE_PHONE_CONFIRMED: 'Shared phone number confirmed',
  MEMBER_ARCHIVED: 'Member archived',
  MEMBER_RESTORED: 'Member restored',
  MEMBER_PHOTO_UPDATED: 'Member photo updated',
  MEMBER_PORTAL_ACCOUNT_CREATED: 'Portal login created',
  MEMBER_ACCESS_BLOCKED: 'Entry blocked',
  MEMBER_ACCESS_UNBLOCKED: 'Entry unblocked',
  MEMBER_PROFILE_SELF_UPDATED: 'Member updated own profile',
  PLAN_CREATED: 'Plan created',
  PLAN_UPDATED: 'Plan updated',
  PLAN_ARCHIVED: 'Plan archived',
  PLAN_UNARCHIVED: 'Plan restored',
};

export const AUDIT_ENTITY_TYPES = ['USER', 'GYM_SETTINGS', 'MEMBER', 'MEMBERSHIP_PLAN'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  CSRF_INVALID: 'CSRF_INVALID',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  DUPLICATE_PHONE_WARNING: 'DUPLICATE_PHONE_WARNING',
  DUPLICATE_PLAN_NAME: 'DUPLICATE_PLAN_NAME',
  MEMBER_ARCHIVED: 'MEMBER_ARCHIVED',
  PORTAL_ACCOUNT_EXISTS: 'PORTAL_ACCOUNT_EXISTS',
  LAST_ADMIN: 'LAST_ADMIN',
  SELF_ACTION_NOT_ALLOWED: 'SELF_ACTION_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** A member's own account switch. INACTIVE is never eligible for entry. */
export const MEMBER_ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type MemberAccountStatus = (typeof MEMBER_ACCOUNT_STATUSES)[number];

export const MEMBER_ACCOUNT_STATUS_LABELS: Record<MemberAccountStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const PLAN_TYPES = ['MONTHLY', 'QUARTERLY', 'SIX_MONTH', 'ANNUAL', 'CUSTOM'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SIX_MONTH: '6 months',
  ANNUAL: 'Annual',
  CUSTOM: 'Custom',
};

export const DURATION_UNITS = ['DAY', 'MONTH'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

/** Fixed plan types always run for this many months (PLAN §3.3); only CUSTOM is free. */
export const FIXED_PLAN_MONTHS: Record<Exclude<PlanType, 'CUSTOM'>, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SIX_MONTH: 6,
  ANNUAL: 12,
};

/** ISO weekdays, Monday = 1 … Sunday = 7. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};
