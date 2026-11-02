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
  'INVOICE_CREATED',
  'INVOICE_VOIDED',
  'PAYMENT_RECORDED',
  'REFUND_ISSUED',
  'TRAINER_PROFILE_UPDATED',
  'TRAINER_AVAILABILITY_UPDATED',
  'TRAINER_TIME_OFF_ADDED',
  'TRAINER_TIME_OFF_CANCELLED',
  'TRAINER_ASSIGNED',
  'TRAINER_ASSIGNMENT_ENDED',
  'SHIFT_CREATED',
  'SHIFT_UPDATED',
  'SHIFT_CANCELLED',
  'CLASS_CREATED',
  'CLASS_UPDATED',
  'CLASS_ARCHIVED',
  'CLASS_SESSIONS_CREATED',
  'CLASS_SESSION_UPDATED',
  'CLASS_SESSION_CANCELLED',
  'CLASS_BOOKED',
  'CLASS_BOOKING_CANCELLED',
  'CLASS_WAITLIST_PROMOTED',
  'CLASS_ATTENDANCE_MARKED',
  'APPOINTMENT_BOOKED',
  'APPOINTMENT_UPDATED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_COMPLETED',
  'APPOINTMENT_NO_SHOW',
  'EXERCISE_CREATED',
  'EXERCISE_UPDATED',
  'EXERCISE_IMAGE_UPDATED',
  'EXERCISE_ARCHIVED',
  'WORKOUT_PLAN_CREATED',
  'WORKOUT_PLAN_UPDATED',
  'WORKOUT_PLAN_ITEMS_UPDATED',
  'WORKOUT_PLAN_DUPLICATED',
  'WORKOUT_PLAN_ARCHIVED',
  'WORKOUT_ASSIGNED',
  'WORKOUT_ASSIGNMENT_UPDATED',
  'PROGRESS_RECORDED',
  'EQUIPMENT_CREATED',
  'EQUIPMENT_UPDATED',
  'EQUIPMENT_STATUS_CHANGED',
  'MAINTENANCE_RECORDED',
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
  INVOICE_CREATED: 'Invoice created',
  INVOICE_VOIDED: 'Invoice voided',
  PAYMENT_RECORDED: 'Payment recorded',
  REFUND_ISSUED: 'Refund issued',
  TRAINER_PROFILE_UPDATED: 'Trainer profile updated',
  TRAINER_AVAILABILITY_UPDATED: 'Trainer availability updated',
  TRAINER_TIME_OFF_ADDED: 'Trainer time off added',
  TRAINER_TIME_OFF_CANCELLED: 'Trainer time off cancelled',
  TRAINER_ASSIGNED: 'Member assigned to trainer',
  TRAINER_ASSIGNMENT_ENDED: 'Trainer assignment ended',
  SHIFT_CREATED: 'Shift scheduled',
  SHIFT_UPDATED: 'Shift updated',
  SHIFT_CANCELLED: 'Shift cancelled',
  CLASS_CREATED: 'Class created',
  CLASS_UPDATED: 'Class updated',
  CLASS_ARCHIVED: 'Class archived',
  CLASS_SESSIONS_CREATED: 'Class sessions scheduled',
  CLASS_SESSION_UPDATED: 'Class session updated',
  CLASS_SESSION_CANCELLED: 'Class session cancelled',
  CLASS_BOOKED: 'Class booked',
  CLASS_BOOKING_CANCELLED: 'Class booking cancelled',
  CLASS_WAITLIST_PROMOTED: 'Promoted from waitlist',
  CLASS_ATTENDANCE_MARKED: 'Class attendance marked',
  APPOINTMENT_BOOKED: 'Appointment booked',
  APPOINTMENT_UPDATED: 'Appointment updated',
  APPOINTMENT_CANCELLED: 'Appointment cancelled',
  APPOINTMENT_COMPLETED: 'Appointment completed',
  APPOINTMENT_NO_SHOW: 'Appointment marked no-show',
  EXERCISE_CREATED: 'Exercise added',
  EXERCISE_UPDATED: 'Exercise updated',
  EXERCISE_IMAGE_UPDATED: 'Exercise image updated',
  EXERCISE_ARCHIVED: 'Exercise archived',
  WORKOUT_PLAN_CREATED: 'Workout plan created',
  WORKOUT_PLAN_UPDATED: 'Workout plan updated',
  WORKOUT_PLAN_ITEMS_UPDATED: 'Workout plan exercises changed',
  WORKOUT_PLAN_DUPLICATED: 'Workout plan duplicated',
  WORKOUT_PLAN_ARCHIVED: 'Workout plan archived',
  WORKOUT_ASSIGNED: 'Workout plan assigned',
  WORKOUT_ASSIGNMENT_UPDATED: 'Workout assignment updated',
  PROGRESS_RECORDED: 'Progress recorded',
  EQUIPMENT_CREATED: 'Equipment added',
  EQUIPMENT_UPDATED: 'Equipment updated',
  EQUIPMENT_STATUS_CHANGED: 'Equipment status changed',
  MAINTENANCE_RECORDED: 'Maintenance recorded',
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
  'INVOICE',
  'PAYMENT',
  'REFUND',
  'TRAINER',
  'TRAINER_ASSIGNMENT',
  'TRAINER_TIME_OFF',
  'STAFF_SHIFT',
  'FITNESS_CLASS',
  'CLASS_SESSION',
  'CLASS_BOOKING',
  'APPOINTMENT',
  'EXERCISE',
  'WORKOUT_PLAN',
  'WORKOUT_ASSIGNMENT',
  'PROGRESS_ENTRY',
  'EQUIPMENT',
  'MAINTENANCE_RECORD',
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
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  OVERPAYMENT: 'OVERPAYMENT',
  PARTIAL_PAYMENT_NOT_ALLOWED: 'PARTIAL_PAYMENT_NOT_ALLOWED',
  REFUND_EXCEEDS_PAYMENT: 'REFUND_EXCEEDS_PAYMENT',
  PAYMENT_NOT_REFUNDABLE: 'PAYMENT_NOT_REFUNDABLE',
  INVOICE_VOID: 'INVOICE_VOID',
  INVOICE_HAS_PAYMENTS: 'INVOICE_HAS_PAYMENTS',
  ONLINE_PAYMENT_NOT_CONFIGURED: 'ONLINE_PAYMENT_NOT_CONFIGURED',
  NOT_A_TRAINER: 'NOT_A_TRAINER',
  TRAINER_NOT_BOOKABLE: 'TRAINER_NOT_BOOKABLE',
  ASSIGNMENT_EXISTS: 'ASSIGNMENT_EXISTS',
  SHIFT_OVERLAP: 'SHIFT_OVERLAP',
  DUPLICATE_CLASS_NAME: 'DUPLICATE_CLASS_NAME',
  CLASS_ARCHIVED: 'CLASS_ARCHIVED',
  CAPACITY_BELOW_BOOKINGS: 'CAPACITY_BELOW_BOOKINGS',
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
  MEMBER_SCHEDULE_CONFLICT: 'MEMBER_SCHEDULE_CONFLICT',
  OUTSIDE_AVAILABILITY: 'OUTSIDE_AVAILABILITY',
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  BOOKING_CLOSED: 'BOOKING_CLOSED',
  CLASS_NOT_BOOKABLE: 'CLASS_NOT_BOOKABLE',
  MEMBERSHIP_NOT_ELIGIBLE: 'MEMBERSHIP_NOT_ELIGIBLE',
  DUPLICATE_EXERCISE_NAME: 'DUPLICATE_EXERCISE_NAME',
  EXERCISE_ARCHIVED: 'EXERCISE_ARCHIVED',
  WORKOUT_PLAN_ARCHIVED: 'WORKOUT_PLAN_ARCHIVED',
  WORKOUT_PLAN_EMPTY: 'WORKOUT_PLAN_EMPTY',
  ASSIGNMENT_CLOSED: 'ASSIGNMENT_CLOSED',
  DUPLICATE_SERIAL_NUMBER: 'DUPLICATE_SERIAL_NUMBER',
  EQUIPMENT_RETIRED: 'EQUIPMENT_RETIRED',
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

// --- Billing (Stage 5) -------------------------------------------------------------------------

/** PLAN §3.4. Always recalculated by the server; never set by a client. */
export const INVOICE_STATUSES = [
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'REFUNDED',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  REFUNDED: 'Refunded',
  VOID: 'Void',
};

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER', 'ONLINE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods staff record at the counter. ONLINE needs a payment provider (D8, not configured). */
export const COUNTER_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const;
export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  OTHER: 'Other',
  ONLINE: 'Online',
};

export const PAYMENT_STATUSES = ['COMPLETED', 'PENDING_CONFIRMATION', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  COMPLETED: 'Completed',
  PENDING_CONFIRMATION: 'Awaiting confirmation',
  FAILED: 'Failed',
};

// --- Trainers, schedules, classes and appointments (Stage 6) ---------------------------------

export const TIME_OFF_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];

export const SHIFT_STATUSES = ['SCHEDULED', 'CANCELLED'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  SCHEDULED: 'Scheduled',
  CANCELLED: 'Cancelled',
};

/** COMPLETED is never stored by an action: a SCHEDULED session that has ended reads as completed. */
export const CLASS_SESSION_STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'] as const;
export type ClassSessionStatus = (typeof CLASS_SESSION_STATUSES)[number];

export const CLASS_SESSION_STATUS_LABELS: Record<ClassSessionStatus, string> = {
  SCHEDULED: 'Scheduled',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

export const BOOKING_STATUSES = [
  'BOOKED',
  'WAITLISTED',
  'CANCELLED',
  'ATTENDED',
  'NO_SHOW',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Bookings that hold a place (or a waitlist spot) and block a second booking. */
export const ACTIVE_BOOKING_STATUSES = ['BOOKED', 'WAITLISTED'] as const;
/** Bookings that use one of the session's places. */
export const SEATED_BOOKING_STATUSES = ['BOOKED', 'ATTENDED', 'NO_SHOW'] as const;

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  BOOKED: 'Booked',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
  ATTENDED: 'Attended',
  NO_SHOW: 'No-show',
};

export const CLASS_ATTENDANCE_STATUSES = ['ATTENDED', 'NO_SHOW'] as const;
export type ClassAttendanceStatus = (typeof CLASS_ATTENDANCE_STATUSES)[number];

export const APPOINTMENT_STATUSES = ['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  BOOKED: 'Booked',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
};

/** One entry on a trainer's (or member's) calendar. */
export const SCHEDULE_ITEM_KINDS = ['CLASS', 'APPOINTMENT', 'TIME_OFF', 'SHIFT'] as const;
export type ScheduleItemKind = (typeof SCHEDULE_ITEM_KINDS)[number];

// --- Workouts, equipment and notifications (Stage 7) -------------------------------------------

export const MUSCLE_GROUPS = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'ARMS',
  'LEGS',
  'GLUTES',
  'CORE',
  'FULL_BODY',
  'CARDIO',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  CHEST: 'Chest',
  BACK: 'Back',
  SHOULDERS: 'Shoulders',
  ARMS: 'Arms',
  LEGS: 'Legs',
  GLUTES: 'Glutes',
  CORE: 'Core',
  FULL_BODY: 'Full body',
  CARDIO: 'Cardio',
};

export const DIFFICULTY_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const DIFFICULTY_LEVEL_LABELS: Record<DifficultyLevel, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
};

export const WORKOUT_PLAN_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type WorkoutPlanStatus = (typeof WORKOUT_PLAN_STATUSES)[number];

export const WORKOUT_ASSIGNMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type WorkoutAssignmentStatus = (typeof WORKOUT_ASSIGNMENT_STATUSES)[number];

export const WORKOUT_ASSIGNMENT_STATUS_LABELS: Record<WorkoutAssignmentStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Body measurements a progress entry may hold, in centimetres. */
export const BODY_MEASUREMENTS = ['chest', 'waist', 'hips', 'arm', 'thigh'] as const;
export type BodyMeasurement = (typeof BODY_MEASUREMENTS)[number];

export const BODY_MEASUREMENT_LABELS: Record<BodyMeasurement, string> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  arm: 'Arm',
  thigh: 'Thigh',
};

export const EQUIPMENT_CATEGORIES = [
  'CARDIO',
  'STRENGTH_MACHINE',
  'FREE_WEIGHTS',
  'FUNCTIONAL',
  'ACCESSORY',
  'OTHER',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  CARDIO: 'Cardio',
  STRENGTH_MACHINE: 'Strength machine',
  FREE_WEIGHTS: 'Free weights',
  FUNCTIONAL: 'Functional',
  ACCESSORY: 'Accessory',
  OTHER: 'Other',
};

export const EQUIPMENT_CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number];

export const EQUIPMENT_CONDITION_LABELS: Record<EquipmentCondition, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
};

/** RETIRED is final: retired equipment keeps its history but can no longer change. */
export const EQUIPMENT_STATUSES = ['IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  IN_SERVICE: 'In service',
  OUT_OF_SERVICE: 'Out of service',
  RETIRED: 'Retired',
};

export const MAINTENANCE_TYPES = ['PREVENTIVE', 'REPAIR', 'INSPECTION'] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  PREVENTIVE: 'Preventive service',
  REPAIR: 'Repair',
  INSPECTION: 'Inspection',
};

export const NOTIFICATION_TYPES = [
  'MEMBERSHIP_EXPIRING',
  'MEMBERSHIP_EXPIRED',
  'MEMBERSHIP_CANCELLED',
  'MEMBERSHIP_SUSPENDED',
  'PAYMENT_DUE',
  'PAYMENT_OVERDUE',
  'RENEWAL_SUCCESS',
  'CLASS_REMINDER',
  'APPOINTMENT_REMINDER',
  'EQUIPMENT_MAINTENANCE_DUE',
  'BIOMETRIC_RETENTION_DUE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  MEMBERSHIP_EXPIRING: 'Membership expiring soon',
  MEMBERSHIP_EXPIRED: 'Membership expired',
  MEMBERSHIP_CANCELLED: 'Membership cancelled',
  MEMBERSHIP_SUSPENDED: 'Membership suspended',
  PAYMENT_DUE: 'Payment due soon',
  PAYMENT_OVERDUE: 'Payment overdue',
  RENEWAL_SUCCESS: 'Membership renewed',
  CLASS_REMINDER: 'Upcoming class',
  APPOINTMENT_REMINDER: 'Upcoming appointment',
  EQUIPMENT_MAINTENANCE_DUE: 'Equipment maintenance due',
  BIOMETRIC_RETENTION_DUE: 'Fingerprint data review due',
};

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};

export const DELIVERY_STATUSES = ['NOT_CONFIGURED', 'SENT', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  NOT_CONFIGURED: 'Not configured',
  SENT: 'Sent',
  FAILED: 'Failed',
};
