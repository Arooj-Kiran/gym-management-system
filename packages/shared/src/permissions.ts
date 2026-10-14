import type { Role } from './roles';

/**
 * Scope of a granted permission (docs/PLAN.md §5).
 * Route middleware only checks that a scope exists; services enforce the narrower scopes.
 */
export const SCOPES = {
  /** "Yes" in the matrix. */
  ALL: 'ALL',
  /** Only the user's own records. */
  OWN: 'OWN',
  /** Only members assigned to the trainer (trainer-safe fields). */
  ASSIGNED: 'ASSIGNED',
  /** Trainer: own plans plus assigned members' plans. */
  OWN_AND_ASSIGNED: 'OWN_AND_ASSIGNED',
  /** Trainer: only class sessions they teach. */
  OWN_SESSIONS: 'OWN_SESSIONS',
  /** Member: only exercises that appear in their assigned plans. */
  VIA_ASSIGNED_PLANS: 'VIA_ASSIGNED_PLANS',
  /** A restricted subset, described next to the entry below. */
  LIMITED: 'LIMITED',
} as const;
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

const { ALL, OWN, ASSIGNED, OWN_AND_ASSIGNED, OWN_SESSIONS, VIA_ASSIGNED_PLANS, LIMITED } = SCOPES;

type Grants = Partial<Record<Role, Scope>>;

const STAFF_OPS: Grants = { ADMIN: ALL, MANAGER: ALL, RECEPTIONIST: ALL };
const ADMIN_MANAGER: Grants = { ADMIN: ALL, MANAGER: ALL };
const ADMIN_ONLY: Grants = { ADMIN: ALL };
const EVERY_ROLE_OWN: Grants = {
  ADMIN: OWN,
  MANAGER: OWN,
  RECEPTIONIST: OWN,
  TRAINER: OWN,
  MEMBER: OWN,
};

/** THE role-permission matrix. Single source of truth for backend enforcement and UI hiding. */
export const PERMISSION_MATRIX = {
  // Staff and system
  'staff:read': ADMIN_MANAGER,
  'staff:manage': ADMIN_ONLY,
  'staff:assign-role': ADMIN_ONLY,
  'settings:read': ADMIN_MANAGER,
  'settings:manage': ADMIN_ONLY,
  'audit:read': ADMIN_ONLY,
  'devices:manage': ADMIN_ONLY,

  // Members (a member edits own emergency contact and photo through /me, not members:update)
  'members:read': { ...STAFF_OPS, TRAINER: ASSIGNED, MEMBER: OWN },
  'members:create': STAFF_OPS,
  'members:update': STAFF_OPS,
  'members:archive': ADMIN_MANAGER,
  'access:restrict': ADMIN_MANAGER,

  // Plans and memberships
  'plans:read': { ...STAFF_OPS, MEMBER: LIMITED }, // members: active plans only
  'plans:manage': ADMIN_ONLY,
  'memberships:read': { ...STAFF_OPS, TRAINER: ASSIGNED, MEMBER: OWN }, // trainer: status and dates only
  'memberships:assign': STAFF_OPS,
  'memberships:activate': STAFF_OPS,
  'memberships:renew': STAFF_OPS,
  'memberships:change-status': ADMIN_MANAGER,

  // Access control and attendance
  'access:simulate': STAFF_OPS,
  'access:monitor': STAFF_OPS,
  'access:read-log': STAFF_OPS,
  'attendance:read': { ...STAFF_OPS, TRAINER: ASSIGNED, MEMBER: OWN },
  'attendance:manual-check-in': STAFF_OPS,
  'attendance:check-out': STAFF_OPS,
  'attendance:correct': ADMIN_MANAGER,
  'biometrics:read-status': { ...STAFF_OPS, MEMBER: OWN },
  'biometrics:manage': ADMIN_MANAGER,

  // Billing
  'payments:read': { ...STAFF_OPS, MEMBER: OWN },
  'payments:record': STAFF_OPS,
  'payments:refund': ADMIN_MANAGER,
  'payments:void': ADMIN_MANAGER,

  // Trainers and schedules
  'trainers:read': { ...STAFF_OPS, TRAINER: ALL, MEMBER: LIMITED }, // members: public profile fields
  'trainers:manage': { ...ADMIN_MANAGER, TRAINER: OWN }, // trainer: own bio and specializations
  'trainers:manage-availability': { ...ADMIN_MANAGER, TRAINER: OWN },
  'trainer-assignments:read': { ...STAFF_OPS, TRAINER: OWN, MEMBER: OWN },
  'trainer-assignments:manage': ADMIN_MANAGER,
  'schedules:read': { ...ADMIN_MANAGER, RECEPTIONIST: OWN, TRAINER: OWN },
  'schedules:manage': ADMIN_MANAGER,

  // Classes and appointments
  'classes:read': { ...STAFF_OPS, TRAINER: ALL, MEMBER: ALL },
  'classes:manage': ADMIN_MANAGER,
  'classes:mark-attendance': { ...STAFF_OPS, TRAINER: OWN_SESSIONS },
  'bookings:read': { ...STAFF_OPS, TRAINER: OWN_SESSIONS, MEMBER: OWN },
  'bookings:manage': { ...STAFF_OPS, MEMBER: OWN }, // member: book or cancel eligible classes
  'appointments:read': { ...STAFF_OPS, TRAINER: OWN, MEMBER: OWN },
  'appointments:manage': { ...STAFF_OPS, TRAINER: OWN, MEMBER: OWN }, // member: cancel only

  // Workouts and progress
  'exercises:read': { ...ADMIN_MANAGER, TRAINER: ALL, MEMBER: VIA_ASSIGNED_PLANS },
  'exercises:manage': { ...ADMIN_MANAGER, TRAINER: ALL },
  'workouts:read': { ...ADMIN_MANAGER, TRAINER: OWN_AND_ASSIGNED, MEMBER: OWN },
  'workouts:manage': { ...ADMIN_MANAGER, TRAINER: OWN }, // trainer: own plans
  'workouts:assign': { ...ADMIN_MANAGER, TRAINER: ASSIGNED },
  'workouts:log': { ...ADMIN_MANAGER, TRAINER: ASSIGNED, MEMBER: OWN },
  'progress:read': { ...ADMIN_MANAGER, TRAINER: ASSIGNED, MEMBER: OWN },
  'progress:record': { ...ADMIN_MANAGER, TRAINER: ASSIGNED, MEMBER: OWN },

  // Equipment
  'equipment:read': { ...STAFF_OPS, TRAINER: ALL },
  'equipment:manage': ADMIN_MANAGER,

  // Dashboard and reports
  'dashboard:read': { ...ADMIN_MANAGER, RECEPTIONIST: LIMITED, TRAINER: OWN }, // receptionist: no revenue
  'reports:operational': { ...ADMIN_MANAGER, RECEPTIONIST: LIMITED }, // receptionist: attendance + denied access
  'reports:financial': ADMIN_MANAGER,

  // Notifications
  'notifications:read': EVERY_ROLE_OWN,
} as const satisfies Record<string, Grants>;

export type Permission = keyof typeof PERMISSION_MATRIX;
export const PERMISSIONS = Object.keys(PERMISSION_MATRIX) as Permission[];

export function permissionScope(role: Role, permission: Permission): Scope | null {
  const grants: Grants = PERMISSION_MATRIX[permission];
  return grants[role] ?? null;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionScope(role, permission) !== null;
}

export function permissionsForRole(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}
