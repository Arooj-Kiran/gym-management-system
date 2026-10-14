export const ROLES = ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TRAINER', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that can hold a staff account (members are managed in the Members module). */
export const STAFF_ROLES = ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TRAINER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  RECEPTIONIST: 'Receptionist',
  TRAINER: 'Trainer',
  MEMBER: 'Member',
};

export function isStaffRole(role: Role): role is StaffRole {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}
