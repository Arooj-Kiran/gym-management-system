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
  'MEMBERSHIP_ASSIGNED',
  'MEMBERSHIP_ACTIVATED',
  'MEMBERSHIP_RENEWED',
  'MEMBERSHIP_EXTENDED',
  'MEMBERSHIP_SUSPENDED',
  'MEMBERSHIP_REACTIVATED',
  'MEMBERSHIP_CANCELLED',
  'MEMBERSHIP_EXPIRED',
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
  MEMBERSHIP_ASSIGNED: 'Membership assigned',
  MEMBERSHIP_ACTIVATED: 'Membership activated',
  MEMBERSHIP_RENEWED: 'Membership renewed',
  MEMBERSHIP_EXTENDED: 'Membership extended',
  MEMBERSHIP_SUSPENDED: 'Membership suspended',
  MEMBERSHIP_REACTIVATED: 'Membership reactivated',
  MEMBERSHIP_CANCELLED: 'Membership cancelled',
  MEMBERSHIP_EXPIRED: 'Membership expired',
};

export const AUDIT_ENTITY_TYPES = [
  'USER',
  'GYM_SETTINGS',
  'MEMBER',
  'MEMBERSHIP_PLAN',
  'MEMBERSHIP',
] as const;
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
  PLAN_ARCHIVED: 'PLAN_ARCHIVED',
  MEMBERSHIP_OVERLAP: 'MEMBERSHIP_OVERLAP',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  MEMBERSHIP_PERIOD_ENDED: 'MEMBERSHIP_PERIOD_ENDED',
  NOT_LATEST_MEMBERSHIP: 'NOT_LATEST_MEMBERSHIP',
  STALE_VERSION: 'STALE_VERSION',
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

/** D2: PENDING = assigned but not yet activated; never eligible for entry. */
export const MEMBERSHIP_STATUSES = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const MEMBERSHIP_EVENT_TYPES = [
  'CREATED',
  'ACTIVATED',
  'RENEWED',
  'EXTENDED',
  'SUSPENDED',
  'REACTIVATED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type MembershipEventType = (typeof MEMBERSHIP_EVENT_TYPES)[number];

export const MEMBERSHIP_EVENT_LABELS: Record<MembershipEventType, string> = {
  CREATED: 'Assigned',
  ACTIVATED: 'Activated',
  RENEWED: 'Renewed',
  EXTENDED: 'Extended',
  SUSPENDED: 'Suspended',
  REACTIVATED: 'Reactivated',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
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
