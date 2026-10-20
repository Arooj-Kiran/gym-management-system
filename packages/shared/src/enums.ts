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
  'ACCESS_MANUAL_CHECK_IN',
  'ATTENDANCE_CORRECTED',
  'DEVICE_CREATED',
  'DEVICE_UPDATED',
  'DEVICE_KEY_ROTATED',
  'DEVICE_DISABLED',
  'DEVICE_ENABLED',
  'BIOMETRIC_CONSENT_GIVEN',
  'BIOMETRIC_CONSENT_WITHDRAWN',
  'BIOMETRIC_ENROLLED',
  'BIOMETRIC_ENROLLMENT_REVOKED',
  'BIOMETRIC_TEMPLATE_DELETED',
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
  ACCESS_MANUAL_CHECK_IN: 'Manual check-in',
  ATTENDANCE_CORRECTED: 'Attendance corrected',
  DEVICE_CREATED: 'Access device added',
  DEVICE_UPDATED: 'Access device updated',
  DEVICE_KEY_ROTATED: 'Device key rotated',
  DEVICE_DISABLED: 'Access device disabled',
  DEVICE_ENABLED: 'Access device enabled',
  BIOMETRIC_CONSENT_GIVEN: 'Biometric consent recorded',
  BIOMETRIC_CONSENT_WITHDRAWN: 'Biometric consent withdrawn',
  BIOMETRIC_ENROLLED: 'Fingerprint enrolled',
  BIOMETRIC_ENROLLMENT_REVOKED: 'Fingerprint enrollment revoked',
  BIOMETRIC_TEMPLATE_DELETED: 'Fingerprint deleted from device',
};

export const AUDIT_ENTITY_TYPES = [
  'USER',
  'GYM_SETTINGS',
  'MEMBER',
  'MEMBERSHIP_PLAN',
  'MEMBERSHIP',
  'ACCESS_ATTEMPT',
  'ATTENDANCE',
  'ACCESS_DEVICE',
  'BIOMETRIC_CONSENT',
  'BIOMETRIC_ENROLLMENT',
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
  ALREADY_CHECKED_OUT: 'ALREADY_CHECKED_OUT',
  ATTENDANCE_VOIDED: 'ATTENDANCE_VOIDED',
  DEVICE_DISABLED: 'DEVICE_DISABLED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CONSENT_ALREADY_GIVEN: 'CONSENT_ALREADY_GIVEN',
  ALREADY_ENROLLED: 'ALREADY_ENROLLED',
  TEMPLATE_REF_IN_USE: 'TEMPLATE_REF_IN_USE',
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

// --- Access control, attendance and biometrics (Stage 4) -------------------------------------

export const ACCESS_RESULTS = ['GRANTED', 'DENIED'] as const;
export type AccessResult = (typeof ACCESS_RESULTS)[number];

/** PLAN §6.4. Every attempt, granted or denied, is stored with exactly one of these. */
export const ACCESS_REASONS = [
  'GRANTED',
  'MEMBER_NOT_RECOGNIZED',
  'MEMBER_INACTIVE',
  'ACCESS_BLOCKED',
  'NO_MEMBERSHIP',
  'MEMBERSHIP_NOT_ACTIVATED',
  'MEMBERSHIP_NOT_STARTED',
  'MEMBERSHIP_EXPIRED',
  'MEMBERSHIP_CANCELLED',
  'MEMBERSHIP_SUSPENDED',
  'OUTSIDE_ACCESS_HOURS',
  'SCANNER_UNAVAILABLE',
  'AUTHORIZATION_UNAVAILABLE',
  'DEVICE_NOT_AUTHORIZED',
] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];

/** Staff-facing labels (access log, attendance). The kiosk uses kioskMessage() instead. */
export const ACCESS_REASON_LABELS: Record<AccessReason, string> = {
  GRANTED: 'Granted',
  MEMBER_NOT_RECOGNIZED: 'Not recognized',
  MEMBER_INACTIVE: 'Member inactive',
  ACCESS_BLOCKED: 'Entry blocked',
  NO_MEMBERSHIP: 'No membership',
  MEMBERSHIP_NOT_ACTIVATED: 'Not activated',
  MEMBERSHIP_NOT_STARTED: 'Not started yet',
  MEMBERSHIP_EXPIRED: 'Expired',
  MEMBERSHIP_CANCELLED: 'Cancelled',
  MEMBERSHIP_SUSPENDED: 'Suspended',
  OUTSIDE_ACCESS_HOURS: 'Outside plan hours',
  SCANNER_UNAVAILABLE: 'Scanner unavailable',
  AUTHORIZATION_UNAVAILABLE: 'Could not verify',
  DEVICE_NOT_AUTHORIZED: 'Device not authorized',
};

/** Derived on the server from the device type (or MANUAL); never taken from the client. */
export const ACCESS_SOURCES = ['SIMULATED', 'REAL', 'MANUAL'] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export const ACCESS_SOURCE_LABELS: Record<AccessSource, string> = {
  SIMULATED: 'Simulated scanner',
  REAL: 'Fingerprint scanner',
  MANUAL: 'Manual check-in',
};

export const DEVICE_TYPES = ['SIMULATED', 'REAL'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  SIMULATED: 'Simulated',
  REAL: 'Real scanner',
};

export const DEVICE_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const DEVICE_HEALTH = ['OK', 'ERROR'] as const;
export type DeviceHealth = (typeof DEVICE_HEALTH)[number];

/** What the scanner reported. Matching happens on the device; the server only sees the ref. */
export const MATCH_RESULTS = ['MATCH', 'NO_MATCH', 'DEVICE_ERROR'] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export const SIMULATOR_SCENARIOS = [
  'NO_MATCH',
  'SCANNER_UNAVAILABLE',
  'AUTHORIZATION_UNAVAILABLE',
] as const;
export type SimulatorScenario = (typeof SIMULATOR_SCENARIOS)[number];

export const SIMULATOR_SCENARIO_LABELS: Record<SimulatorScenario, string> = {
  NO_MATCH: 'Unknown fingerprint',
  SCANNER_UNAVAILABLE: 'Scanner unavailable',
  AUTHORIZATION_UNAVAILABLE: 'Backend cannot verify',
};

export const ATTENDANCE_STATUSES = ['VALID', 'VOIDED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  VALID: 'Valid',
  VOIDED: 'Voided',
};

export const CORRECTION_FIELDS = ['CHECK_IN_AT', 'CHECK_OUT_AT', 'STATUS'] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

export const CORRECTION_FIELD_LABELS: Record<CorrectionField, string> = {
  CHECK_IN_AT: 'Check-in time',
  CHECK_OUT_AT: 'Check-out time',
  STATUS: 'Status',
};

/** REVOKED = waiting for the device to confirm the template was deleted. */
export const ENROLLMENT_STATUSES = ['ACTIVE', 'REVOKED', 'DELETED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  ACTIVE: 'Active',
  REVOKED: 'Deletion pending',
  DELETED: 'Deleted',
};
